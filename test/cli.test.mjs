import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
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
const WARNING = "export function value() {}\n";

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
 * Runs the dx CLI. It runs asynchronously, so the test runner can report each test as soon
 * as it finishes instead of waiting for the blocked process.
 *
 * @param args - CLI arguments.
 * @param cwd - Working directory.
 * @returns The exit status and output.
 */
function dxCli(args, cwd = root) {
  const env = { ...process.env, NO_COLOR: "1" };

  delete env.FORCE_COLOR;

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd, env });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", status => resolve({ status, stdout, stderr }));
  });
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
  it("prints the version", async () => {
    const { status, stdout } = await dxCli(["--version"]);

    assert.equal(status, 0);
    assert.equal(stdout.trim(), pkg.version);
  });

  it("prints help without a TTY and contains no emojis", async () => {
    const { status, stdout } = await dxCli([]);

    assert.equal(status, 0);
    assert.match(stdout, /Commands/);
    assert.doesNotMatch(stdout, /\p{Extended_Pictographic}/u);
  });

  it("rejects unknown commands and options", async () => {
    assert.equal((await dxCli(["nope"])).status, 2);
    assert.equal((await dxCli(["lint", "--nope"])).status, 2);
    assert.equal((await dxCli(["lint", "--changed", "--staged"])).status, 2);
  });
});

describe("init", () => {
  it("writes eslint.config.mjs for CommonJS packages", async () => {
    const dir = project({ "package.json": "{}" });

    assert.equal((await dxCli(["init"], dir)).status, 0);
    assert.ok(existsSync(path.join(dir, "eslint.config.mjs")));
  });

  it("writes eslint.config.js for ESM packages, with frameworks and scripts", async () => {
    const dir = project({ "package.json": "{\n  \"type\": \"module\",\n  \"dependencies\": {}\n}\n" });

    assert.equal((await dxCli(["init", "--react", "--scripts"], dir)).status, 0);
    assert.match(readFileSync(path.join(dir, "eslint.config.js"), "utf8"), /react: true/);

    const manifest = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
    const scripts = manifest.scripts;

    assert.deepEqual(Object.keys(manifest), ["type", "scripts", "dependencies"]);

    assert.equal(scripts.lint, "dx lint");
    assert.equal(scripts["lint:fix"], "dx lint --fix");
  });

  it("refuses to overwrite and backs up with --force", async () => {
    const dir = project({ "package.json": "{}", "eslint.config.mjs": "export default [];\n" });

    assert.equal((await dxCli(["init"], dir)).status, 1);
    assert.equal((await dxCli(["init", "--force"], dir)).status, 0);
    assert.equal(readFileSync(path.join(dir, "eslint.config.mjs.bak"), "utf8"), "export default [];\n");
  });
});

describe("lint", () => {
  it("falls back to the built-in config and reports errors", async () => {
    const dir = project({ "bad.js": BAD });
    const { status, stdout, stderr } = await dxCli(["lint"], dir);

    assert.equal(status, 1);
    assert.match(stdout, /no-console/);
    assert.match(stderr, /built-in dx defaults/);
  });

  it("passes on clean code", async () => {
    const dir = project({ "good.js": GOOD });

    assert.equal((await dxCli(["lint"], dir)).status, 0);
  });

  it("fixes files", async () => {
    const dir = project({ "fixable.js": "export const value = 'a'\n" });

    assert.equal((await dxCli(["fix"], dir)).status, 0);
    assert.equal(readFileSync(path.join(dir, "fixable.js"), "utf8"), "export const value = \"a\";\n");
  });

  it("keeps stdout clean for machine readable formats", async () => {
    const dir = project({ "bad.js": BAD });
    const { stdout } = await dxCli(["lint", "--format", "json"], dir);

    assert.ok(Array.isArray(JSON.parse(stdout)));
  });

  it("only lints changed and staged files", async () => {
    const dir = project({ "committed.js": BAD });

    git(dir, ["init", "-q"]);
    git(dir, ["add", "."]);
    git(dir, ["commit", "-qm", "init"]);

    assert.equal((await dxCli(["lint", "--changed"], dir)).status, 0);

    writeFileSync(path.join(dir, "new.js"), BAD);

    const changed = await dxCli(["lint", "--changed"], dir);

    assert.equal(changed.status, 1);
    assert.match(changed.stdout, /new\.js/);
    assert.doesNotMatch(changed.stdout, /committed\.js/);
    assert.equal((await dxCli(["lint", "--staged"], dir)).status, 0);
  });

  it("lints large projects with worker threads, with quiet and warning limits", async () => {
    // 120 files make ESLint start worker threads, which rebuild the dx options on their own.
    const files = Object.fromEntries(Array.from({ length: 120 }, (_, index) => [`file${index}.js`, WARNING]));
    const dir = project({ ...files, "bad.js": BAD });

    const all = await dxCli(["lint", "--format", "json"], dir);
    const results = JSON.parse(all.stdout);

    assert.equal(all.status, 1);
    assert.equal(results.length, 121);
    assert.equal(results.reduce((total, result) => total + result.warningCount, 0), 120);
    assert.doesNotMatch(all.stderr, /Warning/);

    const quiet = JSON.parse((await dxCli(["lint", "--quiet", "--format", "json"], dir)).stdout);

    assert.equal(quiet.length, 1);
    assert.ok(quiet[0].messages.every(message => message.severity === 2));

    rmSync(path.join(dir, "bad.js"));

    assert.equal((await dxCli(["lint", "--max-warnings", "120"], dir)).status, 0);
    assert.equal((await dxCli(["lint", "--max-warnings", "119"], dir)).status, 1);
  });

  it("fixes files with worker threads", async () => {
    const files = Object.fromEntries(Array.from({ length: 120 }, (_, index) => [`file${index}.js`, "export const value = 'a'\n"]));
    const dir = project(files);
    const { status, stderr } = await dxCli(["fix"], dir);

    assert.equal(status, 0);
    assert.match(stderr, /fixed 120 files/);
    assert.equal(readFileSync(path.join(dir, "file119.js"), "utf8"), "export const value = \"a\";\n");
  });

  it("fails outside of git when a git scope is requested", async () => {
    const dir = project({ "good.js": GOOD });

    assert.equal((await dxCli(["lint", "--staged"], dir)).status, 2);
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
