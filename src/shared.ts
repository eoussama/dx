import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";



/** Set by the dx CLI so the config lints like CI, even from an editor terminal. */
export const DX_CLI_ENV = "DX_CLI";

/**
 * @description
 * Looks for a pnpm workspace file in the given directory or any of its parents.
 *
 * @param cwd - Directory to start searching from.
 * @returns Whether a pnpm-workspace.yaml file was found.
 */
export function hasPnpmWorkspace(cwd: string = process.cwd()): boolean {
  let dir = path.resolve(cwd);

  while (true) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
      return true;
    }

    const parent = path.dirname(dir);

    if (parent === dir) {
      return false;
    }

    dir = parent;
  }
}
