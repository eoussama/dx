import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { after } from "node:test";
import { fileURLToPath } from "node:url";



export const root = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
export const BAD = "const unused = 1\nconsole.log('hi')\n";
export const GOOD = "export const value = 1;\n";
export const WARNING = "export function value() {}\n";
export const FIXABLE = "export const value = 'a'\n";

const dirs = [];

after(() => dirs.forEach(dir => rmSync(dir, { recursive: true, force: true })));

/**
 * @description
 * Creates a temporary project directory.
 *
 * @param files - Files to create, keyed by relative path.
 * @returns The real path of the project directory.
 */
export function project(files = {}) {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "dx-unit-")));

  dirs.push(dir);

  for (const [name, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), content);
  }

  return dir;
}

/**
 * @description
 * Runs git in a directory.
 *
 * @param cwd - Working directory.
 * @param args - Git arguments.
 */
export function git(cwd, args) {
  execFileSync("git", ["-c", "user.email=dx@test", "-c", "user.name=dx", "-c", "init.defaultBranch=main", ...args], { cwd, stdio: "ignore" });
}

/**
 * @description
 * Creates a git repository with everything committed.
 *
 * @param files - Files to commit, keyed by relative path.
 * @returns The repository directory.
 */
export function repo(files = {}) {
  const dir = project(files);

  git(dir, ["init", "-q"]);

  if (Object.keys(files).length) {
    git(dir, ["add", "."]);
    git(dir, ["commit", "-qm", "init"]);
  }

  return dir;
}

/**
 * @description
 * Checks whether the current write comes from the dx terminal helpers, the only sources
 * that write to stdout and stderr.
 *
 * @returns Whether the write comes from the sources.
 */
function fromTerm() {
  return /[\\/]src[\\/]lib[\\/]term\.ts\b/.test(new Error("write").stack ?? "");
}

/**
 * @description
 * Captures what the sources write to stdout and stderr while a task runs. Other writes go
 * through, since the test runner reports its results on stdout too.
 *
 * @param task - The task.
 * @returns The task result and the captured output.
 */
export async function capture(task) {
  const out = process.stdout.write;
  const err = process.stderr.write;
  let stdout = "";
  let stderr = "";

  process.stdout.write = function (chunk, ...args) {
    if (!fromTerm()) {
      return Reflect.apply(out, this, [chunk, ...args]);
    }

    stdout += chunk;

    return true;
  };
  process.stderr.write = function (chunk, ...args) {
    if (!fromTerm()) {
      return Reflect.apply(err, this, [chunk, ...args]);
    }

    stderr += chunk;

    return true;
  };

  try {
    return { result: await task(), stdout, stderr };
  }
  finally {
    process.stdout.write = out;
    process.stderr.write = err;
  }
}

/**
 * @description
 * Runs a task with another working directory.
 *
 * @param cwd - The working directory.
 * @param task - The task.
 * @returns The task result.
 */
export async function inDir(cwd, task) {
  const previous = process.cwd();

  process.chdir(cwd);

  try {
    return await task();
  }
  finally {
    process.chdir(previous);
  }
}
