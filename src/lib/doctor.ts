import type { Linter } from "eslint";
import type { Framework } from "./project";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { ESLint } from "eslint";
import { version as dxVersion } from "../../package.json";
import dx from "../index";
import { DX_CLI_ENV, hasPnpmWorkspace } from "../shared";
import { isGitRepo } from "./git";
import {
  detectFrameworks,
  detectPackageManager,
  existingFiles,
  findFlatConfig,
  findPackageJson,
  installCommand,
  installedVersion,
  LEGACY_CONFIG_FILES,
  PRETTIER_CONFIG_FILES,
} from "./project";
import { errorMessage } from "./term";



export type CheckStatus = "ok" | "info" | "warn" | "error";

export interface Check {
  status: CheckStatus;
  label: string;
  detail: string;
}

export const NODE_RANGE = "^20.19.0 || ^22.13.0 || >=24";

/**
 * @description
 * Checks whether a Node.js version satisfies the supported range.
 *
 * @param version - Node.js version, without the leading v.
 * @returns Whether the version is supported.
 */
export function isSupportedNode(version: string): boolean {
  const [nodeMajor = 0, nodeMinor = 0] = version.split(".").map(Number);

  return (nodeMajor === 20 && nodeMinor >= 19) || (nodeMajor === 22 && nodeMinor >= 13) || nodeMajor >= 24;
}

/**
 * @description
 * Gets the major version of a semver string.
 *
 * @param version - Version string.
 * @returns The major version number.
 */
function major(version: string): number {
  return Number.parseInt(version, 10);
}

/**
 * @description
 * Checks whether the resolved config applies a framework's rules.
 *
 * @param eslint - ESLint instance for the project, if the config loaded.
 * @param root - Project directory.
 * @param framework - The framework to check.
 * @returns Whether rules of the framework are configured.
 */
async function isFrameworkEnabled(eslint: ESLint | undefined, root: string, framework: Framework): Promise<boolean> {
  try {
    const config = await eslint?.calculateConfigForFile(path.join(root, framework.sampleFile)) as Linter.Config | undefined;

    return Object.keys(config?.rules ?? {}).some(rule => rule.startsWith(`${framework.id}/`));
  }
  catch {
    return false;
  }
}

/**
 * @description
 * Checks the project setup and reports anything that could break or degrade linting.
 *
 * @param cwd - Project directory.
 * @returns The list of checks.
 */
export async function doctor(cwd: string): Promise<Check[]> {
  const root = path.resolve(cwd);
  const checks: Check[] = [];
  const add = (status: CheckStatus, label: string, detail: string): number => checks.push({ status, label, detail });
  const manager = detectPackageManager(root);

  // Runtime
  const nodeOk = isSupportedNode(process.versions.node);

  add(nodeOk ? "ok" : "error", "Node.js", `v${process.versions.node}${nodeOk ? "" : ` (requires ${NODE_RANGE})`}`);
  add("info", "dx CLI", `v${dxVersion}, bundled ESLint v${ESLint.version}`);

  // Manifest
  const manifest = findPackageJson(root);

  if (manifest) {
    add("ok", "package.json", `${path.relative(root, manifest.file) || "package.json"} (${manifest.pkg.type === "module" ? "ESM" : "CommonJS"})`);
  }
  else {
    add("warn", "package.json", "not found, dx init will write eslint.config.mjs");
  }

  add("info", "Package manager", manager);

  // Local packages
  const localDx = installedVersion(root, "@eoussama/dx");

  if (!localDx) {
    add("warn", "@eoussama/dx", `not installed in this project, run: ${installCommand(manager, ["@eoussama/dx"])}`);
  }
  else {
    add(localDx === dxVersion ? "ok" : "info", "@eoussama/dx", `v${localDx}${localDx === dxVersion ? "" : ` (CLI is v${dxVersion})`}`);
  }

  const localEslint = installedVersion(root, "eslint");

  if (localEslint && major(localEslint) !== major(ESLint.version)) {
    add("warn", "eslint", `project has v${localEslint}, dx uses v${ESLint.version}`);
  }
  else if (localEslint) {
    add("ok", "eslint", `v${localEslint}`);
  }

  const localTs = installedVersion(root, "typescript");

  if (localTs && major(localTs) >= 7) {
    add("warn", "TypeScript", `v${localTs} has no JS API, typescript-eslint needs TypeScript 6 installed as "typescript". Run: ${installCommand(manager, ["typescript@npm:@typescript/typescript6@^6", "@typescript/native@npm:typescript@^7"])}`);
  }
  else if (localTs) {
    add("ok", "TypeScript", `v${localTs}`);
  }

  // Config
  const configFile = findFlatConfig(root);

  if (!configFile) {
    add("warn", "ESLint config", "none found, dx lint uses the built-in dx defaults. Run: dx init");
  }
  else {
    const usesDx = readFileSync(configFile, "utf8").includes("@eoussama/dx");

    add(usesDx ? "ok" : "warn", "ESLint config", `${path.relative(root, configFile) || configFile}${usesDx ? "" : " does not import @eoussama/dx"}`);
  }

  process.env[DX_CLI_ENV] = "1";

  let eslint: ESLint | undefined;

  try {
    eslint = new ESLint({
      cwd: root,
      ...(configFile ? {} : { overrideConfigFile: true, overrideConfig: await dx() as Linter.Config[] }),
    });

    await eslint.calculateConfigForFile(path.join(root, "index.ts"));
    add("ok", "Config loads", "no errors");
  }
  catch (error) {
    add("error", "Config loads", errorMessage(error).split("\n")[0] ?? "unknown error");
  }

  const legacy = existingFiles(root, LEGACY_CONFIG_FILES);

  if (legacy.length) {
    add("warn", "Legacy config", `${legacy.join(", ")} is ignored by flat config ESLint, remove it`);
  }

  const prettier = existingFiles(root, PRETTIER_CONFIG_FILES);

  if (prettier.length) {
    add("warn", "Prettier", `${prettier.join(", ")} found, it will fight with dx stylistic rules`);
  }

  // Frameworks
  for (const framework of detectFrameworks(manifest?.pkg)) {
    const missing = framework.plugins.filter(name => !installedVersion(root, name));
    const install = missing.length ? `, install: ${installCommand(manager, missing)}` : "";

    if (await isFrameworkEnabled(eslint, root, framework)) {
      add(missing.length ? "warn" : "ok", framework.label, `enabled${install}`);
    }
    else {
      add("info", framework.label, `detected but not enabled, use dx({ ${framework.id}: true })${install}`);
    }
  }

  if (hasPnpmWorkspace(root)) {
    add("info", "pnpm workspace", "catalog rules enabled");
  }

  // Editor
  const vscodeSettings = path.join(root, ".vscode", "settings.json");

  if (existsSync(path.join(root, ".vscode"))) {
    const configured = existsSync(vscodeSettings) && readFileSync(vscodeSettings, "utf8").includes("source.fixAll.eslint");

    add(configured ? "ok" : "info", "VS Code", configured ? "fix on save configured" : "run dx init --vscode to enable fix on save");
  }

  const inGit = isGitRepo(root);

  add(inGit ? "ok" : "info", "Git", inGit ? "--changed, --staged and --since available" : "not a repository, --changed/--staged unavailable");

  return checks;
}
