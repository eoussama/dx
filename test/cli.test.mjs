import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import dx from "@eoussama/dx";
import { ESLint } from "eslint";



const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cli = path.join(root, "dist", "cli.mjs");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const dirs = [];

const BAD = "const unused = 1\nconsole.log('hi')\n";
const GOOD = "export const value = 1;\n";

/**
 * @description
 * Creates a temporary project directory.
 *
 * @param files - Files to create, keyed by relative path.
 * @returns The project directory.
 */
function project(files = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "dx-test-"));

  dirs.push(dir);

  for (const [name, content] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), content);
  }

  return dir;
}

/**
 * @description
 * Runs the dx CLI.
 *
 * @param args - CLI arguments.
 * @param cwd - Working directory.
 * @returns The exit status and output.
 */
function dxCli(args, cwd = root) {
  const env = { ...process.env, NO_COLOR: "1" };

  delete env.FORCE_COLOR;

  const result = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8", env });

  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/**
 * @description
 * Runs git in a directory.
 *
 * @param cwd - Working directory.
 * @param args - Git arguments.
 */
function git(cwd, args) {
  execFileSync("git", ["-c", "user.email=dx@test", "-c", "user.name=dx", ...args], { cwd, stdio: "ignore" });
}

after(() => dirs.forEach(dir => rmSync(dir, { recursive: true, force: true })));

describe("cli", () => {
  it("prints the version", () => {
    const { status, stdout } = dxCli(["--version"]);

    assert.equal(status, 0);
    assert.equal(stdout.trim(), pkg.version);
  });

  it("prints help without a TTY and contains no emojis", () => {
    const { status, stdout } = dxCli([]);

    assert.equal(status, 0);
    assert.match(stdout, /Commands/);
    assert.doesNotMatch(stdout, /\p{Extended_Pictographic}/u);
  });

  it("rejects unknown commands and options", () => {
    assert.equal(dxCli(["nope"]).status, 2);
    assert.equal(dxCli(["lint", "--nope"]).status, 2);
    assert.equal(dxCli(["lint", "--changed", "--staged"]).status, 2);
  });
});

describe("init", () => {
  it("writes eslint.config.mjs for CommonJS packages", () => {
    const dir = project({ "package.json": "{}" });

    assert.equal(dxCli(["init"], dir).status, 0);
    assert.ok(existsSync(path.join(dir, "eslint.config.mjs")));
  });

  it("writes eslint.config.js for ESM packages, with frameworks and scripts", () => {
    const dir = project({ "package.json": "{\n  \"type\": \"module\",\n  \"dependencies\": {}\n}\n" });

    assert.equal(dxCli(["init", "--react", "--scripts"], dir).status, 0);
    assert.match(readFileSync(path.join(dir, "eslint.config.js"), "utf8"), /react: true/);

    const manifest = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
    const scripts = manifest.scripts;

    assert.deepEqual(Object.keys(manifest), ["type", "scripts", "dependencies"]);

    assert.equal(scripts.lint, "dx lint");
    assert.equal(scripts["lint:fix"], "dx lint --fix");
  });

  it("refuses to overwrite and backs up with --force", () => {
    const dir = project({ "package.json": "{}", "eslint.config.mjs": "export default [];\n" });

    assert.equal(dxCli(["init"], dir).status, 1);
    assert.equal(dxCli(["init", "--force"], dir).status, 0);
    assert.equal(readFileSync(path.join(dir, "eslint.config.mjs.bak"), "utf8"), "export default [];\n");
  });
});

describe("lint", () => {
  it("falls back to the built-in config and reports errors", () => {
    const dir = project({ "bad.js": BAD });
    const { status, stdout, stderr } = dxCli(["lint"], dir);

    assert.equal(status, 1);
    assert.match(stdout, /no-console/);
    assert.match(stderr, /built-in dx defaults/);
  });

  it("passes on clean code", () => {
    const dir = project({ "good.js": GOOD });

    assert.equal(dxCli(["lint"], dir).status, 0);
  });

  it("fixes files", () => {
    const dir = project({ "fixable.js": "export const value = 'a'\n" });

    assert.equal(dxCli(["fix"], dir).status, 0);
    assert.equal(readFileSync(path.join(dir, "fixable.js"), "utf8"), "export const value = \"a\";\n");
  });

  it("keeps stdout clean for machine readable formats", () => {
    const dir = project({ "bad.js": BAD });
    const { stdout } = dxCli(["lint", "--format", "json"], dir);

    assert.ok(Array.isArray(JSON.parse(stdout)));
  });

  it("only lints changed and staged files", () => {
    const dir = project({ "committed.js": BAD });

    git(dir, ["init", "-q"]);
    git(dir, ["add", "."]);
    git(dir, ["commit", "-qm", "init"]);

    assert.equal(dxCli(["lint", "--changed"], dir).status, 0);

    writeFileSync(path.join(dir, "new.js"), BAD);

    const changed = dxCli(["lint", "--changed"], dir);

    assert.equal(changed.status, 1);
    assert.match(changed.stdout, /new\.js/);
    assert.doesNotMatch(changed.stdout, /committed\.js/);
    assert.equal(dxCli(["lint", "--staged"], dir).status, 0);
  });

  it("fails outside of git when a git scope is requested", () => {
    const dir = project({ "good.js": GOOD });

    assert.equal(dxCli(["lint", "--staged"], dir).status, 2);
  });
});

describe("config", () => {
  /**
   * @description
   * Resolves the rules applied to a file for a dx config.
   *
   * @param config - The dx config composer.
   * @returns The resolved rules.
   */
  async function rulesFor(config) {
    const eslint = new ESLint({ cwd: root, overrideConfigFile: true, overrideConfig: await config });

    return (await eslint.calculateConfigForFile(path.join(root, "src", "index.ts"))).rules;
  }

  it("merges user rules and stylistic options with the defaults", async () => {
    const rules = await rulesFor(dx({ isInEditor: false, rules: { curly: "off" }, stylistic: { indent: 4 } }));

    assert.equal(rules.curly[0], 0);
    assert.equal(rules["no-console"][0], 2);
    assert.equal(rules["style/quotes"][1], "double");
    assert.equal(rules["style/indent"][1], 4);
  });

  it("supports disabling stylistic rules", async () => {
    const rules = await rulesFor(dx({ isInEditor: false, stylistic: false }));

    assert.equal(rules["style/padding-line-between-statements"], undefined);
    assert.equal(rules["no-console"][0], 2);
  });
});
