import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { describeInitStep, doctorExitCode, formatCheck, resolveScope, runLint, summarizeLint } from "../../src/lib/commands.ts";
import { BAD, capture, GOOD, project, repo } from "./helpers.mjs";



const REPORT = {
  configFile: "/project/eslint.config.js",
  fileCount: 3,
  errorCount: 0,
  warningCount: 0,
  fixableCount: 0,
  fixedFileCount: 0,
  output: "",
  durationMs: 12,
  tooManyWarnings: false,
  ok: true,
};

const summarize = (report, options = {}) => summarizeLint({ ...REPORT, ...report }, { cwd: "/project", ...options });

describe("summarizeLint", () => {
  it("reports clean runs", () => {
    assert.deepEqual(summarize({}), { level: "success", message: "No problems in 3 files (12ms)", hints: [] });
    assert.equal(summarize({ fileCount: 1 }).message, "No problems in 1 file (12ms)");
  });

  it("reports runs without files", () => {
    assert.deepEqual(summarize({ fileCount: 0 }), { level: "success", message: "No files to lint (12ms)", hints: [] });
    assert.equal(summarize({ fileCount: 0 }, { scope: { kind: "staged" } }).message, "No staged files to lint (12ms)");
    assert.equal(summarize({ fileCount: 0, errorCount: 1, ok: false }).level, "success");
  });

  it("hints at dx init without a config file", () => {
    const hint = "No ESLint config found, used the built-in dx defaults. Run `dx init` to add one.";

    assert.deepEqual(summarize({ configFile: undefined }).hints, [hint]);
    assert.deepEqual(summarize({ configFile: undefined, fileCount: 0 }).hints, [hint]);
  });

  it("counts errors and warnings", () => {
    assert.deepEqual(summarize({ errorCount: 2, warningCount: 1, ok: false }), {
      level: "error",
      message: "2 errors, 1 warning in 3 files (12ms)",
      hints: [],
    });
    assert.deepEqual(summarize({ errorCount: 1, ok: false }), { level: "error", message: "1 error in 3 files (12ms)", hints: [] });
    assert.deepEqual(summarize({ warningCount: 2 }), { level: "warn", message: "2 warnings in 3 files (12ms)", hints: [] });
  });

  it("mentions fixed files when fixing", () => {
    assert.equal(summarize({ fixedFileCount: 2 }, { fix: true }).message, "No problems in 3 files, fixed 2 files (12ms)");
    assert.equal(summarize({ fixedFileCount: 1, warningCount: 1 }, { fix: true }).message, "1 warning in 3 files, fixed 1 file (12ms)");
    assert.equal(summarize({ fixedFileCount: 0 }, { fix: true }).message, "No problems in 3 files (12ms)");
    assert.equal(summarize({ fixedFileCount: 2 }, { fix: false }).message, "No problems in 3 files (12ms)");
  });

  it("hints at dx fix for formatters without their own summary", () => {
    const fixable = { errorCount: 2, fixableCount: 2, ok: false };
    const hint = "2 problems can be fixed with `dx fix`.";

    assert.deepEqual(summarize(fixable, { format: "json" }).hints, [hint]);
    assert.deepEqual(summarize({ ...fixable, fixableCount: 1 }, { format: "json" }).hints, ["1 problem can be fixed with `dx fix`."]);
    assert.deepEqual(summarize(fixable, { format: "stylish" }).hints, []);
    assert.deepEqual(summarize(fixable).hints, []);
    assert.deepEqual(summarize(fixable, { format: "json", fix: true }).hints, []);
    assert.deepEqual(summarize({ ...fixable, fixableCount: 0 }, { format: "json" }).hints, []);
  });

  it("explains failures caused by warnings", () => {
    assert.deepEqual(summarize({ warningCount: 3, tooManyWarnings: true, ok: false }, { maxWarnings: 2 }), {
      level: "error",
      message: "3 warnings in 3 files (12ms)",
      hints: ["Too many warnings, the limit is 2."],
    });
  });
});

describe("runLint", () => {
  it("prints the formatter output and a summary", async () => {
    const dir = project({ "bad.js": BAD });
    const { result, stdout, stderr } = await capture(() => runLint({ cwd: dir }));

    assert.equal(result, 1);
    assert.match(stdout, /no-console/);
    assert.match(stdout, /\n\n$/);
    assert.match(stderr, /^fail {2}\d+ errors? in 1 file \(\d+(?:ms|\.\d+s)\)\nhint {2}No ESLint config found/);
  });

  it("succeeds on clean code without printing an empty report", async () => {
    const dir = project({ "good.js": GOOD });
    const { result, stdout, stderr } = await capture(() => runLint({ cwd: dir }));

    assert.equal(result, 0);
    assert.equal(stdout, "");
    assert.match(stderr, /^done {2}No problems in 1 file/);
  });

  it("reports warnings without failing", async () => {
    const dir = project({ "eslint.config.mjs": "export default [{ rules: { \"no-console\": \"warn\" } }];\n", "warn.js": "console.log(1);\n" });
    const { result, stderr } = await capture(() => runLint({ cwd: dir }));

    assert.equal(result, 0);
    assert.match(stderr, /^warn {2}1 warning in 2 files/);
  });

  it("refuses git scopes outside of a repository", async () => {
    const dir = project();
    const { result, stderr } = await capture(() => runLint({ cwd: dir, scope: { kind: "staged" } }));

    assert.equal(result, 2);
    assert.equal(stderr, "error Cannot lint staged files outside of a git repository.\n");
  });

  it("lints git scopes inside a repository", async () => {
    const dir = repo({ "committed.js": BAD });
    const { result, stderr } = await capture(() => runLint({ cwd: dir, scope: { kind: "changed" } }));

    assert.equal(result, 0);
    assert.match(stderr, /^done {2}No changed files to lint/);
  });

  it("reports fatal errors", async () => {
    const dir = project({ "good.js": GOOD });
    const { result, stderr } = await capture(() => runLint({ cwd: dir, patterns: ["missing.js"] }));

    assert.equal(result, 2);
    assert.equal(stderr, "error No files matching 'missing.js' were found.\n");
  });
});

describe("describeInitStep", () => {
  it("describes each step", () => {
    assert.equal(describeInitStep({ kind: "written", file: "a.js" }), "Wrote a.js");
    assert.equal(describeInitStep({ kind: "backup", from: "a.js", to: "a.js.bak" }), "Moved a.js to a.js.bak");
    assert.equal(describeInitStep({ kind: "skipped", file: "a.js", reason: "why" }), "Skipped a.js: why");
  });
});

describe("doctor helpers", () => {
  it("formats checks in aligned columns", () => {
    assert.equal(formatCheck({ status: "ok", label: "Node.js", detail: "v24" }), "ok    Node.js          v24");
    assert.equal(formatCheck({ status: "info", label: "a", detail: "b" }), "info  a                b");
    assert.equal(formatCheck({ status: "warn", label: "a", detail: "b" }), "warn  a                b");
    assert.equal(formatCheck({ status: "error", label: "a", detail: "b" }), "error a                b");
  });

  it("fails only on errors", () => {
    assert.equal(doctorExitCode([]), 0);
    assert.equal(doctorExitCode([{ status: "ok" }, { status: "info" }, { status: "warn" }]), 0);
    assert.equal(doctorExitCode([{ status: "ok" }, { status: "error" }]), 1);
  });
});

describe("resolveScope", () => {
  it("resolves each flag", () => {
    assert.equal(resolveScope({}), undefined);
    assert.equal(resolveScope({ changed: false, staged: false }), undefined);
    assert.deepEqual(resolveScope({ changed: true }), { kind: "changed" });
    assert.deepEqual(resolveScope({ staged: true }), { kind: "staged" });
    assert.deepEqual(resolveScope({ since: "main" }), { kind: "since", ref: "main" });
    assert.deepEqual(resolveScope({ since: "" }), { kind: "since", ref: "" });
  });

  it("rejects combined flags", () => {
    const message = { message: "--changed, --staged and --since cannot be combined." };

    assert.throws(() => resolveScope({ changed: true, staged: true }), message);
    assert.throws(() => resolveScope({ changed: true, since: "main" }), message);
    assert.throws(() => resolveScope({ staged: true, since: "" }), message);
    assert.deepEqual(resolveScope({ changed: true, staged: false }), { kind: "changed" });
  });
});
