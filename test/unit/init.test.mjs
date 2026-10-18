import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { configFileName, configSource, init, InitError, LINT_SCRIPTS, VSCODE_SETTINGS } from "../../src/lib/init.ts";
import { project } from "./helpers.mjs";



const read = (dir, file) => readFileSync(path.join(dir, file), "utf8");
const readJson = (dir, file) => JSON.parse(read(dir, file));

describe("config file", () => {
  it("uses .js for ESM packages and .mjs otherwise", () => {
    assert.equal(configFileName(project({ "package.json": "{\"type\":\"module\"}" })), "eslint.config.js");
    assert.equal(configFileName(project({ "package.json": "{\"type\":\"commonjs\"}" })), "eslint.config.mjs");
    assert.equal(configFileName(project({ "package.json": "{}" })), "eslint.config.mjs");
    assert.equal(configFileName(project()), "eslint.config.mjs");
  });

  it("generates the config source", () => {
    assert.equal(configSource(), "import dx from \"@eoussama/dx\";\n\n\n\nexport default dx();\n");
    assert.equal(configSource([]), configSource());
    assert.equal(configSource(["react"]), "import dx from \"@eoussama/dx\";\n\n\n\nexport default dx({\n  react: true,\n});\n");
    assert.equal(
      configSource(["react", "svelte"]),
      "import dx from \"@eoussama/dx\";\n\n\n\nexport default dx({\n  react: true,\n  svelte: true,\n});\n",
    );
  });
});

describe("init", () => {
  it("writes the config file", () => {
    const dir = project({ "package.json": "{\"type\":\"module\"}" });

    assert.deepEqual(init({ cwd: dir, frameworks: ["svelte"] }), [{ kind: "written", file: "eslint.config.js" }]);
    assert.equal(read(dir, "eslint.config.js"), configSource(["svelte"]));
    assert.deepEqual(readdirSync(dir).sort(), ["eslint.config.js", "package.json"]);
  });

  it("resolves relative directories", () => {
    const dir = project();

    assert.deepEqual(init({ cwd: path.relative(process.cwd(), dir) }), [{ kind: "written", file: "eslint.config.mjs" }]);
    assert.ok(existsSync(path.join(dir, "eslint.config.mjs")));
  });

  it("refuses to replace existing configs without force", () => {
    const dir = project({ "eslint.config.js": "a", "eslint.config.ts": "b" });

    assert.throws(() => init({ cwd: dir }), (error) => {
      assert.ok(error instanceof InitError);
      assert.ok(error instanceof Error);
      assert.equal(error.message, "eslint.config.js, eslint.config.ts already exists. Use --force to replace it (a .bak copy is kept).");

      return true;
    });
    assert.throws(() => init({ cwd: dir, force: false }), InitError);
    assert.equal(read(dir, "eslint.config.js"), "a");
  });

  it("backs up existing configs with force, without overwriting backups", () => {
    const dir = project({ "eslint.config.mjs": "first", "eslint.config.cjs": "other" });

    assert.deepEqual(init({ cwd: dir, force: true }), [
      { kind: "backup", from: "eslint.config.mjs", to: "eslint.config.mjs.bak" },
      { kind: "backup", from: "eslint.config.cjs", to: "eslint.config.cjs.bak" },
      { kind: "written", file: "eslint.config.mjs" },
    ]);

    writeFileSync(path.join(dir, "eslint.config.mjs"), "second");
    init({ cwd: dir, force: true });
    writeFileSync(path.join(dir, "eslint.config.mjs"), "third");

    assert.deepEqual(init({ cwd: dir, force: true }).slice(0, 1), [
      { kind: "backup", from: "eslint.config.mjs", to: "eslint.config.mjs.bak2" },
    ]);
    assert.equal(read(dir, "eslint.config.mjs.bak"), "first");
    assert.equal(read(dir, "eslint.config.mjs.bak1"), "second");
    assert.equal(read(dir, "eslint.config.mjs.bak2"), "third");
    assert.equal(read(dir, "eslint.config.cjs.bak"), "other");
    assert.equal(read(dir, "eslint.config.mjs"), configSource());
  });
});

describe("scripts", () => {
  it("skips projects without package.json", () => {
    const dir = project();

    assert.deepEqual(init({ cwd: dir, scripts: true }).slice(1), [{ kind: "skipped", file: "package.json", reason: "not found" }]);
    assert.ok(!existsSync(path.join(dir, "package.json")));
  });

  it("adds the scripts before the dependency fields", () => {
    for (const field of ["dependencies", "devDependencies", "peerDependencies", "peerDependenciesMeta", "optionalDependencies", "bundledDependencies"]) {
      const dir = project({ "package.json": JSON.stringify({ name: "x", [field]: {}, license: "MIT" }) });

      assert.deepEqual(init({ cwd: dir, scripts: true }).slice(1), [{ kind: "written", file: "package.json" }]);
      assert.deepEqual(Object.keys(readJson(dir, "package.json")), ["name", "scripts", field, "license"]);
    }
  });

  it("appends the scripts when there are no dependency fields", () => {
    const dir = project({ "package.json": "{\"name\":\"x\",\"version\":\"1.0.0\"}" });

    init({ cwd: dir, scripts: true });

    assert.deepEqual(readJson(dir, "package.json"), { name: "x", version: "1.0.0", scripts: LINT_SCRIPTS });
    assert.deepEqual(LINT_SCRIPTS, { "lint": "dx lint", "lint:fix": "dx lint --fix" });
  });

  it("keeps existing scripts in place and preserves the indentation", () => {
    const dir = project({ "package.json": "{\n    \"scripts\": {\n        \"build\": \"tsc\"\n    },\n    \"name\": \"x\"\n}\n" });

    init({ cwd: dir, scripts: true });

    assert.equal(
      read(dir, "package.json"),
      "{\n    \"scripts\": {\n        \"build\": \"tsc\",\n        \"lint\": \"dx lint\",\n        \"lint:fix\": \"dx lint --fix\"\n    },\n    \"name\": \"x\"\n}\n",
    );
  });

  it("replaces scripts placed after the dependencies in place", () => {
    const dir = project({ "package.json": JSON.stringify({ dependencies: {}, scripts: { build: "tsc" } }) });

    init({ cwd: dir, scripts: true });

    const manifest = readJson(dir, "package.json");

    assert.deepEqual(Object.keys(manifest), ["dependencies", "scripts"]);
    assert.deepEqual(manifest.scripts, { build: "tsc", ...LINT_SCRIPTS });
  });

  it("only detects indentation at the start of a line", () => {
    const dir = project({ "package.json": "{\"name\": \"x\"}" });

    init({ cwd: dir, scripts: true });

    assert.match(read(dir, "package.json"), /^\{\n {2}"name": "x",\n {2}"scripts"/);
  });

  it("preserves tab indentation and defaults to two spaces", () => {
    const tabs = project({ "package.json": "{\n\t\"name\": \"x\"\n}\n" });
    const flat = project({ "package.json": "{\"name\":\"x\"}" });

    init({ cwd: tabs, scripts: true });
    init({ cwd: flat, scripts: true });

    assert.match(read(tabs, "package.json"), /^\{\n\t"name": "x",\n\t"scripts": \{\n\t\t"lint"/);
    assert.match(read(flat, "package.json"), /^\{\n {2}"name": "x",\n {2}"scripts": \{\n {4}"lint"/);
  });

  it("does nothing when the scripts are already set", () => {
    const source = JSON.stringify({ scripts: LINT_SCRIPTS });
    const dir = project({ "package.json": source });

    assert.deepEqual(init({ cwd: dir, scripts: true }).slice(1), []);
    assert.equal(read(dir, "package.json"), source);
  });

  it("keeps different scripts unless forced", () => {
    const dir = project({ "package.json": JSON.stringify({ scripts: { "lint": "eslint .", "lint:fix": "dx lint --fix" } }) });

    assert.deepEqual(init({ cwd: dir, scripts: true }).slice(1), [
      { kind: "skipped", file: "package.json#scripts.lint", reason: "already set to \"eslint .\"" },
    ]);
    assert.equal(readJson(dir, "package.json").scripts.lint, "eslint .");

    assert.deepEqual(init({ cwd: dir, scripts: true, force: true }).slice(2), [{ kind: "written", file: "package.json" }]);
    assert.deepEqual(readJson(dir, "package.json").scripts, LINT_SCRIPTS);
  });

  it("writes the remaining scripts when one is skipped", () => {
    const dir = project({ "package.json": JSON.stringify({ scripts: { lint: "eslint ." } }) });

    assert.deepEqual(init({ cwd: dir, scripts: true }).slice(1), [
      { kind: "skipped", file: "package.json#scripts.lint", reason: "already set to \"eslint .\"" },
      { kind: "written", file: "package.json" },
    ]);
    assert.deepEqual(readJson(dir, "package.json").scripts, { "lint": "eslint .", "lint:fix": "dx lint --fix" });
  });

  it("replaces empty scripts", () => {
    const dir = project({ "package.json": JSON.stringify({ scripts: { "lint": "", "lint:fix": "" } }) });

    assert.deepEqual(init({ cwd: dir, scripts: true }).slice(1), [{ kind: "written", file: "package.json" }]);
    assert.deepEqual(readJson(dir, "package.json").scripts, LINT_SCRIPTS);
  });
});

describe("vscode settings", () => {
  const settings = path.join(".vscode", "settings.json");

  it("creates the settings", () => {
    const dir = project();

    assert.deepEqual(init({ cwd: dir, vscode: true }).slice(1), [{ kind: "written", file: settings }]);
    assert.deepEqual(readJson(dir, settings), VSCODE_SETTINGS);
    assert.match(read(dir, settings), /^\{\n {2}"prettier\.enable": false,\n[\s\S]*\}\n$/);
    assert.deepEqual(VSCODE_SETTINGS, {
      "prettier.enable": false,
      "editor.formatOnSave": false,
      "editor.codeActionsOnSave": {
        "source.fixAll.eslint": "explicit",
        "source.organizeImports": "never",
      },
      "eslint.validate": [
        "javascript",
        "javascriptreact",
        "typescript",
        "typescriptreact",
        "vue",
        "svelte",
        "html",
        "markdown",
        "json",
        "jsonc",
        "yaml",
        "toml",
      ],
    });
  });

  it("merges into existing settings and keeps their indentation", () => {
    const dir = project({
      [settings]: JSON.stringify({
        "editor.tabSize": 2,
        "prettier.enable": true,
        "editor.codeActionsOnSave": { "source.fixAll.stylelint": "explicit", "source.organizeImports": "always" },
      }, null, 4),
    });

    init({ cwd: dir, vscode: true });

    const merged = readJson(dir, settings);

    assert.equal(merged["editor.tabSize"], 2);
    assert.equal(merged["prettier.enable"], false);
    assert.deepEqual(merged["editor.codeActionsOnSave"], {
      "source.fixAll.stylelint": "explicit",
      "source.fixAll.eslint": "explicit",
      "source.organizeImports": "never",
    });
    assert.match(read(dir, settings), /^\{\n {4}"editor\.tabSize": 2,/);
  });

  it("treats empty settings as no settings", () => {
    const dir = project({ [settings]: "  \n" });

    assert.deepEqual(init({ cwd: dir, vscode: true }).slice(1), [{ kind: "written", file: settings }]);
    assert.deepEqual(readJson(dir, settings), VSCODE_SETTINGS);
  });

  it("skips settings with comments", () => {
    const source = "{\n  // comment\n  \"a\": 1\n}\n";
    const dir = project({ [settings]: source });

    assert.deepEqual(init({ cwd: dir, vscode: true }).slice(1), [
      { kind: "skipped", file: settings, reason: "contains comments or invalid JSON, merge the settings manually" },
    ]);
    assert.equal(read(dir, settings), source);
  });

  it("combines scripts and settings", () => {
    const dir = project({ "package.json": "{}" });

    assert.deepEqual(init({ cwd: dir, scripts: true, vscode: true }), [
      { kind: "written", file: "eslint.config.mjs" },
      { kind: "written", file: "package.json" },
      { kind: "written", file: settings },
    ]);
  });
});
