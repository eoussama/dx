import assert from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { describeScope, gitFiles, isGitRepo } from "../../src/lib/git.ts";
import { git, project, repo } from "./helpers.mjs";



/**
 * @description
 * Lists the files of a scope relative to a directory, sorted.
 *
 * @param dir - Directory to list from.
 * @param scope - The git scope.
 * @returns The relative paths.
 */
function files(dir, scope) {
  return gitFiles(dir, scope).map(file => path.relative(dir, file).replaceAll("\\", "/")).sort();
}

describe("isGitRepo", () => {
  it("detects git work trees", () => {
    assert.equal(isGitRepo(repo()), true);
    assert.equal(isGitRepo(project()), false);
    assert.equal(isGitRepo(path.join(project(), "missing")), false);
  });

  it("keeps git errors out of the output", () => {
    const write = process.stderr.write;
    let stderr = "";

    process.stderr.write = (chunk) => {
      stderr += chunk;

      return true;
    };

    try {
      assert.equal(isGitRepo(project()), false);
    }
    finally {
      process.stderr.write = write;
    }

    assert.equal(stderr, "");
  });
});

describe("gitFiles", () => {
  it("lists changed and untracked files, without deleted and ignored ones", () => {
    const dir = repo({ "kept.js": "", "edited.js": "", "deleted.js": "", ".gitignore": "ignored.js\n" });

    writeFileSync(path.join(dir, "edited.js"), "changed");
    writeFileSync(path.join(dir, "new.js"), "");
    writeFileSync(path.join(dir, "ignored.js"), "");
    rmSync(path.join(dir, "deleted.js"));

    assert.deepEqual(files(dir, { kind: "changed" }), ["edited.js", "new.js"]);
  });

  it("returns absolute paths", () => {
    const dir = repo({ "a.js": "" });

    writeFileSync(path.join(dir, "a.js"), "changed");

    assert.deepEqual(gitFiles(dir, { kind: "changed" }), [path.join(dir, "a.js")]);
  });

  it("lists every file before the first commit", () => {
    const dir = repo();

    writeFileSync(path.join(dir, "staged.js"), "");
    writeFileSync(path.join(dir, "untracked.js"), "");
    git(dir, ["add", "staged.js"]);

    assert.deepEqual(files(dir, { kind: "changed" }), ["staged.js", "untracked.js"]);
    assert.deepEqual(files(dir, { kind: "staged" }), ["staged.js"]);
  });

  it("skips staged files that were deleted since", () => {
    const fresh = repo();

    writeFileSync(path.join(fresh, "gone.js"), "");
    writeFileSync(path.join(fresh, "kept.js"), "");
    git(fresh, ["add", "."]);
    rmSync(path.join(fresh, "gone.js"));

    assert.deepEqual(files(fresh, { kind: "changed" }), ["kept.js"]);
    assert.deepEqual(files(fresh, { kind: "staged" }), ["kept.js"]);
  });

  it("lists staged files only", () => {
    const dir = repo({ "a.js": "" });

    writeFileSync(path.join(dir, "a.js"), "changed");
    writeFileSync(path.join(dir, "b.js"), "");
    writeFileSync(path.join(dir, "c.js"), "");
    git(dir, ["add", "b.js"]);

    assert.deepEqual(files(dir, { kind: "staged" }), ["b.js"]);
  });

  it("lists files changed since a ref, including untracked ones", () => {
    const dir = repo({ "base.js": "" });

    git(dir, ["checkout", "-qb", "feature"]);
    writeFileSync(path.join(dir, "committed.js"), "");
    git(dir, ["add", "."]);
    git(dir, ["commit", "-qm", "feature"]);
    writeFileSync(path.join(dir, "untracked.js"), "");
    writeFileSync(path.join(dir, "base.js"), "changed");

    assert.deepEqual(files(dir, { kind: "since", ref: "main" }), ["base.js", "committed.js", "untracked.js"]);
    assert.deepEqual(files(dir, { kind: "since", ref: "HEAD" }), ["base.js", "untracked.js"]);
    assert.throws(() => gitFiles(dir, { kind: "since", ref: "missing" }));
  });

  it("limits the files to the directory", () => {
    const dir = repo({ "root.js": "", "sub/inner.js": "" });

    writeFileSync(path.join(dir, "root.js"), "changed");
    writeFileSync(path.join(dir, "sub", "inner.js"), "changed");
    writeFileSync(path.join(dir, "sub", "new.js"), "");
    git(dir, ["add", "sub/new.js"]);

    assert.deepEqual(files(path.join(dir, "sub"), { kind: "changed" }), ["inner.js", "new.js"]);
    assert.deepEqual(files(path.join(dir, "sub"), { kind: "staged" }), ["new.js"]);
  });

  it("handles large outputs", () => {
    const dir = repo();
    const names = Array.from({ length: 200 }, (_, index) => `a-rather-long-file-name-to-fill-the-git-output-${index}.js`);

    names.forEach(name => writeFileSync(path.join(dir, name), ""));

    assert.deepEqual(files(dir, { kind: "changed" }), names.sort());
  });

  it("handles file names with spaces and newlines", () => {
    const dir = repo({ "a.js": "" });
    const odd = process.platform === "win32" ? "with space.js" : "with\nnewline.js";

    writeFileSync(path.join(dir, odd), "");

    assert.deepEqual(files(dir, { kind: "changed" }), [odd]);
  });
});

describe("describeScope", () => {
  it("describes each scope", () => {
    assert.equal(describeScope({ kind: "changed" }), "changed files");
    assert.equal(describeScope({ kind: "staged" }), "staged files");
    assert.equal(describeScope({ kind: "since", ref: "main" }), "files changed since main");
  });
});
