import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";



export type GitScope
  = | { kind: "changed" }
    | { kind: "staged" }
    | { kind: "since"; ref: string };

/**
 * @description
 * Runs a git command and returns its stdout.
 *
 * @param cwd - Working directory.
 * @param args - Git arguments.
 * @returns The command output.
 */
function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
}

/**
 * @description
 * Splits NUL separated git output into paths.
 *
 * @param output - Raw git output.
 * @returns The list of paths.
 */
function splitPaths(output: string): string[] {
  return output.split("\0").filter(Boolean);
}

/**
 * @description
 * Checks whether a directory is inside a git work tree.
 *
 * @param cwd - Directory to check.
 * @returns Whether git is available and the directory is tracked.
 */
export function isGitRepo(cwd: string): boolean {
  try {
    return git(cwd, ["rev-parse", "--is-inside-work-tree"]).trim() === "true";
  }
  catch {
    return false;
  }
}

/**
 * @description
 * Checks whether the repository has at least one commit.
 *
 * @param cwd - Directory inside the repository.
 * @returns Whether HEAD resolves.
 */
function hasHead(cwd: string): boolean {
  try {
    git(cwd, ["rev-parse", "--verify", "--quiet", "HEAD"]);

    return true;
  }
  catch {
    return false;
  }
}

/**
 * @description
 * Lists the files matching a git scope, limited to the given directory.
 * Deleted files are excluded since there is nothing left to lint.
 *
 * @param cwd - Directory to scope the results to.
 * @param scope - Which files to collect.
 * @returns Absolute paths of the matching files.
 */
export function gitFiles(cwd: string, scope: GitScope): string[] {
  const diff = ["diff", "--name-only", "--relative", "--diff-filter=ACMR", "-z"];
  const untracked = () => splitPaths(git(cwd, ["ls-files", "--others", "--exclude-standard", "-z"]));
  let files: string[];

  if (scope.kind === "staged") {
    files = splitPaths(git(cwd, [...diff, "--cached"]));
  }
  else if (scope.kind === "since") {
    const base = git(cwd, ["merge-base", scope.ref, "HEAD"]).trim();

    files = [...splitPaths(git(cwd, [...diff, base])), ...untracked()];
  }
  else if (hasHead(cwd)) {
    files = [...splitPaths(git(cwd, [...diff, "HEAD"])), ...untracked()];
  }
  else {
    files = splitPaths(git(cwd, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"]));
  }

  return [...new Set(files)]
    .map(file => path.resolve(cwd, file))
    .filter(file => existsSync(file));
}

/**
 * @description
 * Describes a git scope for humans.
 *
 * @param scope - The git scope.
 * @returns A short description.
 */
export function describeScope(scope: GitScope): string {
  switch (scope.kind) {
    case "staged":
      return "staged files";

    case "since":
      return `files changed since ${scope.ref}`;

    default:
      return "changed files";
  }
}
