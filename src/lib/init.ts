import type { Framework } from "./project";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import { existingFiles, FLAT_CONFIG_FILES, readPackageJson } from "./project";



export interface InitOptions {
  cwd: string;
  force?: boolean;
  scripts?: boolean;
  vscode?: boolean;
  frameworks?: Framework["id"][];
}

export type InitStep
  = | { kind: "written"; file: string }
    | { kind: "backup"; from: string; to: string }
    | { kind: "skipped"; file: string; reason: string };

/**
 *
 */
export class InitError extends Error {}

export const LINT_SCRIPTS: Record<string, string> = {
  "lint": "dx lint",
  "lint:fix": "dx lint --fix",
};

const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "peerDependenciesMeta",
  "optionalDependencies",
  "bundledDependencies",
];

export const VSCODE_SETTINGS = {
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
};



/**
 * @description
 * Picks the config file name that Node will load as an ES module for this project.
 *
 * @param cwd - Project directory.
 * @returns The config file name.
 */
export function configFileName(cwd: string): string {
  const pkg = readPackageJson(path.join(cwd, "package.json"));

  return pkg?.type === "module" ? "eslint.config.js" : "eslint.config.mjs";
}

/**
 * @description
 * Generates the content of the ESLint config file.
 *
 * @param frameworks - Frameworks to enable.
 * @returns The config file source.
 */
export function configSource(frameworks: Framework["id"][] = []): string {
  const options = frameworks.length
    ? `{\n${frameworks.map(id => `  ${id}: true,`).join("\n")}\n}`
    : "";

  return `import dx from "@eoussama/dx";



export default dx(${options});
`;
}

/**
 * @description
 * Detects the indentation used by a JSON document.
 *
 * @param source - JSON source.
 * @returns The indentation string.
 */
function detectIndent(source: string): string {
  return /^([ \t]+)"/m.exec(source)?.[1] ?? "  ";
}

/**
 * @description
 * Sets the scripts of a manifest, inserting a new scripts field before the dependency
 * fields so the result keeps the conventional package.json key order.
 *
 * @param pkg - The manifest.
 * @param scripts - The scripts to set.
 * @returns The updated manifest.
 */
function withScripts(pkg: Record<string, unknown>, scripts: Record<string, string>): Record<string, unknown> {
  if ("scripts" in pkg) {
    return { ...pkg, scripts };
  }

  const keys = Object.keys(pkg);
  const index = keys.findIndex(key => DEPENDENCY_FIELDS.includes(key));
  const entries = Object.entries(pkg);

  entries.splice(index === -1 ? keys.length : index, 0, ["scripts", scripts]);

  return Object.fromEntries(entries);
}

/**
 * @description
 * Adds the lint scripts to package.json without overwriting different existing ones.
 *
 * @param cwd - Project directory.
 * @param force - Overwrite scripts that already exist.
 * @returns The performed steps.
 */
function addScripts(cwd: string, force: boolean): InitStep[] {
  const file = path.join(cwd, "package.json");

  if (!existsSync(file)) {
    return [{ kind: "skipped", file: "package.json", reason: "not found" }];
  }

  const source = readFileSync(file, "utf8");
  const pkg = JSON.parse(source) as Record<string, unknown> & { scripts?: Record<string, string> };
  const scripts = { ...pkg.scripts };
  const steps: InitStep[] = [];
  let changed = false;

  for (const [name, command] of Object.entries(LINT_SCRIPTS)) {
    if (scripts[name] === command) {
      continue;
    }

    if (scripts[name] && !force) {
      steps.push({ kind: "skipped", file: `package.json#scripts.${name}`, reason: `already set to "${scripts[name]}"` });
      continue;
    }

    scripts[name] = command;
    changed = true;
  }

  if (changed) {
    writeFileSync(file, `${JSON.stringify(withScripts(pkg, scripts), null, detectIndent(source))}\n`, "utf8");
    steps.push({ kind: "written", file: "package.json" });
  }

  return steps;
}

/**
 * @description
 * Merges the recommended editor settings into .vscode/settings.json.
 *
 * @param cwd - Project directory.
 * @returns The performed steps.
 */
function addVscodeSettings(cwd: string): InitStep[] {
  const dir = path.join(cwd, ".vscode");
  const file = path.join(dir, "settings.json");
  const relative = path.join(".vscode", "settings.json");
  let current: Record<string, unknown> = {};
  let indent = "  ";

  if (existsSync(file)) {
    const source = readFileSync(file, "utf8");

    indent = detectIndent(source);

    try {
      current = source.trim() ? JSON.parse(source) as Record<string, unknown> : {};
    }
    catch {
      return [{ kind: "skipped", file: relative, reason: "contains comments or invalid JSON, merge the settings manually" }];
    }
  }

  const merged = {
    ...current,
    ...VSCODE_SETTINGS,
    "editor.codeActionsOnSave": {
      ...(current["editor.codeActionsOnSave"] as Record<string, unknown> | undefined),
      ...VSCODE_SETTINGS["editor.codeActionsOnSave"],
    },
  };

  mkdirSync(dir, { recursive: true });
  writeFileSync(file, `${JSON.stringify(merged, null, indent)}\n`, "utf8");

  return [{ kind: "written", file: relative }];
}

/**
 * @description
 * Sets up a project to use the dx ESLint config.
 * Existing flat config files are only replaced with force, and are backed up first.
 *
 * @param options - Init options.
 * @returns The performed steps.
 */
export function init(options: InitOptions): InitStep[] {
  const cwd = path.resolve(options.cwd);
  const existing = existingFiles(cwd, FLAT_CONFIG_FILES);
  const steps: InitStep[] = [];

  if (existing.length && !options.force) {
    throw new InitError(`${existing.join(", ")} already exists. Use --force to replace it (a .bak copy is kept).`);
  }

  for (const name of existing) {
    let backup = `${name}.bak`;
    let index = 1;

    while (existsSync(path.join(cwd, backup))) {
      backup = `${name}.bak${index++}`;
    }

    renameSync(path.join(cwd, name), path.join(cwd, backup));
    steps.push({ kind: "backup", from: name, to: backup });
  }

  const target = configFileName(cwd);

  writeFileSync(path.join(cwd, target), configSource(options.frameworks), "utf8");
  steps.push({ kind: "written", file: target });

  if (options.scripts) {
    steps.push(...addScripts(cwd, options.force ?? false));
  }

  if (options.vscode) {
    steps.push(...addVscodeSettings(cwd));
  }

  return steps;
}
