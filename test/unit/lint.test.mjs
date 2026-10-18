import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { lint } from "../../src/lib/lint.ts";
import { BAD, FIXABLE, GOOD, project, repo, WARNING } from "./helpers.mjs";



/** Errors on console calls and warns on unused variables, without depending on any package. */
const CONFIG = "export default [{ rules: { \"no-console\": \"error\", \"no-unused-vars\": \"warn\", \"quotes\": [\"warn\", \"double\"] } }];\n";

describe("lint", () => {
  it("uses the built-in config when the project has none", async () => {
    const dir = project({ "bad.js": BAD, "good.js": GOOD });
    const before = performance.now();
    const report = await lint({ cwd: dir });
    const elapsed = performance.now() - before;

    assert.equal(report.configFile, undefined);
    assert.equal(report.fileCount, 2);
    assert.ok(report.errorCount >= 2);
    assert.equal(report.ok, false);
    assert.equal(report.tooManyWarnings, false);
    assert.match(report.output, /no-console/);
    assert.equal(report.output, report.output.trim());
    assert.ok(report.durationMs > 0);
    assert.ok(report.durationMs <= elapsed);
    assert.equal(process.env.DX_CLI, "1");
  });

  it("uses the project config file and counts every kind of problem", async () => {
    const dir = project({ "eslint.config.mjs": CONFIG, "a.js": "const a = 'x';\nconsole.log(1);\n" });
    const report = await lint({ cwd: dir });

    assert.equal(report.configFile, path.join(dir, "eslint.config.mjs"));
    assert.deepEqual({ ...report, output: undefined, durationMs: undefined }, {
      configFile: path.join(dir, "eslint.config.mjs"),
      fileCount: 2,
      errorCount: 1,
      warningCount: 2,
      fixableCount: 1,
      fixedFileCount: 0,
      output: undefined,
      durationMs: undefined,
      tooManyWarnings: false,
      ok: false,
    });
  });

  it("only lints the given patterns", async () => {
    const dir = project({ "eslint.config.mjs": CONFIG, "src/a.js": "console.log(1);\n", "other/b.js": "console.log(1);\n" });
    const report = await lint({ cwd: dir, patterns: ["src"] });

    assert.equal(report.fileCount, 1);
    assert.match(report.output, /a\.js/);
    assert.doesNotMatch(report.output, /b\.js/);
    assert.equal((await lint({ cwd: dir, patterns: [] })).fileCount, 3);
  });

  it("fixes files", async () => {
    const dir = project({ "eslint.config.mjs": CONFIG, "a.js": "export const a = 'x';\n", "b.js": "export const b = \"x\";\n" });
    const report = await lint({ cwd: dir, fix: true });

    assert.equal(report.fixedFileCount, 1);
    assert.equal(report.warningCount, 0);
    assert.equal(report.ok, true);
    assert.equal(readFileSync(path.join(dir, "a.js"), "utf8"), "export const a = \"x\";\n");
  });

  it("does not write fixes without fix", async () => {
    const dir = project({ "eslint.config.mjs": CONFIG, "a.js": "export const a = 'x';\n" });
    const report = await lint({ cwd: dir });

    assert.equal(report.fixedFileCount, 0);
    assert.equal(report.fixableCount, 1);
    assert.equal(readFileSync(path.join(dir, "a.js"), "utf8"), "export const a = 'x';\n");
  });

  it("reports errors only when quiet", async () => {
    const dir = project({ "eslint.config.mjs": CONFIG, "a.js": "const a = 'x';\nconsole.log(1);\n", "b.js": "const b = 1;\n" });
    const report = await lint({ cwd: dir, quiet: true, format: "json" });
    const results = JSON.parse(report.output);

    assert.equal(report.warningCount, 0);
    assert.equal(report.errorCount, 1);
    assert.equal(report.fixableCount, 0);
    assert.equal(results.length, 1);
    assert.deepEqual(results[0].messages.map(message => message.ruleId), ["no-console"]);
  });

  it("fails when there are more warnings than allowed", async () => {
    const dir = project({ "eslint.config.mjs": CONFIG, "a.js": "const a = 1;\n", "b.js": "const b = 1;\n" });
    const report = async maxWarnings => lint({ cwd: dir, maxWarnings });

    assert.deepEqual(await report(undefined).then(({ tooManyWarnings, ok }) => ({ tooManyWarnings, ok })), { tooManyWarnings: false, ok: true });
    assert.deepEqual(await report(2).then(({ tooManyWarnings, ok }) => ({ tooManyWarnings, ok })), { tooManyWarnings: false, ok: true });
    assert.deepEqual(await report(1).then(({ tooManyWarnings, ok }) => ({ tooManyWarnings, ok })), { tooManyWarnings: true, ok: false });
    assert.deepEqual(await report(0).then(({ tooManyWarnings, ok }) => ({ tooManyWarnings, ok })), { tooManyWarnings: true, ok: false });
    assert.equal((await lint({ cwd: dir, maxWarnings: 0, quiet: true })).ok, true);
  });

  it("uses the requested formatter", async () => {
    const dir = project({ "good.js": GOOD });

    assert.deepEqual(JSON.parse((await lint({ cwd: dir, format: "json" })).output).map(result => result.errorCount), [0]);
    assert.equal((await lint({ cwd: dir })).output, "");
    await assert.rejects(lint({ cwd: dir, format: "missing-formatter" }));
  });

  it("ignores formatters that do not return text", async () => {
    const dir = project({ "good.js": GOOD, "formatter.cjs": "module.exports = () => undefined;\n" });

    assert.equal((await lint({ cwd: dir, format: path.join(dir, "formatter.cjs") })).output, "");
  });

  it("caches results in node_modules", async () => {
    const dir = project({ "good.js": GOOD });

    await lint({ cwd: dir, cache: true });

    assert.ok(existsSync(path.join(dir, "node_modules", ".cache", "dx", "eslintcache")));
    assert.ok(!existsSync(path.join(dir, ".eslintcache")));
  });

  it("does not cache by default", async () => {
    const dir = project({ "good.js": GOOD });

    await lint({ cwd: dir });

    assert.ok(!existsSync(path.join(dir, "node_modules")));
  });

  it("lints the files of a git scope, and nothing when there are none", async () => {
    const dir = repo({ "eslint.config.mjs": CONFIG, "committed.js": "console.log(1);\n", "ignored.js": "", ".gitignore": "ignored.js\n" });
    const before = performance.now();
    const empty = await lint({ cwd: dir, scope: { kind: "changed" } });
    const elapsed = performance.now() - before;

    assert.deepEqual({ ...empty, durationMs: 0 }, {
      configFile: path.join(dir, "eslint.config.mjs"),
      fileCount: 0,
      errorCount: 0,
      warningCount: 0,
      fixableCount: 0,
      fixedFileCount: 0,
      output: "",
      durationMs: 0,
      tooManyWarnings: false,
      ok: true,
    });
    assert.ok(empty.durationMs >= 0);
    assert.ok(empty.durationMs <= elapsed);

    writeFileSync(path.join(dir, "new.js"), "console.log(1);\n");
    writeFileSync(path.join(dir, "notes.txt"), "");

    const changed = await lint({ cwd: dir, scope: { kind: "changed" }, patterns: ["committed.js"] });

    assert.equal(changed.fileCount, 1);
    assert.match(changed.output, /new\.js/);
  });

  it("lints large projects with worker threads", async () => {
    const files = Object.fromEntries(Array.from({ length: 120 }, (_, index) => [`file${index}.js`, WARNING]));
    const dir = project({ ...files, "fixable.js": FIXABLE });
    const warnings = [];
    const listener = warning => warnings.push(warning.name);

    process.on("warning", listener);

    try {
      const report = await lint({ cwd: dir, quiet: true, fix: true });

      assert.equal(report.fileCount, 121);
      assert.equal(report.errorCount, 0);
      assert.equal(report.fixedFileCount, 1);
      assert.equal(readFileSync(path.join(dir, "fixable.js"), "utf8"), "export const value = \"a\";\n");
    }
    finally {
      process.off("warning", listener);
    }

    assert.ok(!warnings.includes("ESLintPoorConcurrencyWarning"));
  });
});

describe("warnings", () => {
  /** Emits warnings while the config loads, the way ESLint reports poor concurrency. */
  const EMITTING_CONFIG = `
process.emitWarning("dropped", "ESLintPoorConcurrencyWarning");
process.emitWarning("dropped", { type: "ESLintPoorConcurrencyWarning" });
process.emitWarning("kept", "CustomWarning");
process.emitWarning("kept", { type: "CustomOptionsWarning" });
process.emitWarning("kept");
export default [{}];
`;

  it("drops poor concurrency warnings only, while linting", async () => {
    const dir = project({ "eslint.config.mjs": EMITTING_CONFIG, "good.js": GOOD });
    const original = process.emitWarning;
    const warnings = [];
    const listener = warning => warnings.push(`${warning.name}: ${warning.message}`);

    process.on("warning", listener);

    try {
      await lint({ cwd: dir });
      await new Promise(resolve => setImmediate(resolve));
    }
    finally {
      process.off("warning", listener);
    }

    assert.deepEqual(warnings, ["CustomWarning: kept", "CustomOptionsWarning: kept", "Warning: kept"]);
    assert.equal(process.emitWarning, original);
  });

  it("restores the warning emitter when linting fails", async () => {
    const dir = project({ "eslint.config.mjs": "throw new Error(\"broken config\");\n", "good.js": GOOD });
    const original = process.emitWarning;

    await assert.rejects(lint({ cwd: dir }), /broken config/);
    assert.equal(process.emitWarning, original);
  });
});
