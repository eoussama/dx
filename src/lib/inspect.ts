import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";

import { DX_CLI_ENV } from "../shared";



/**
 * @description
 * Resolves the ESLint binary shipped with dx.
 *
 * @returns Absolute path to the ESLint bin script.
 */
function eslintBin(): string {
  const require = createRequire(import.meta.url);

  return path.join(path.dirname(require.resolve("eslint/package.json")), "bin", "eslint.js");
}

/**
 * @description
 * Opens the ESLint config inspector for the project in the browser.
 *
 * @param cwd - Project directory.
 * @returns The exit code of the inspector.
 */
export function inspect(cwd: string): Promise<number> {
  // Ctrl+C stops the inspector, not dx, so the TUI can return to its menu.
  const ignoreInterrupt = (): void => {};

  process.on("SIGINT", ignoreInterrupt);

  return new Promise<number>((resolve) => {
    const child = spawn(process.execPath, [eslintBin(), "--inspect-config"], {
      cwd,
      stdio: "inherit",
      env: { ...process.env, [DX_CLI_ENV]: "1" },
    });

    child.on("error", () => resolve(1));
    child.on("close", code => resolve(code ?? 0));
  }).finally(() => process.off("SIGINT", ignoreInterrupt));
}
