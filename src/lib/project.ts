import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";



export type PackageManager = "pnpm" | "yarn" | "bun" | "npm";

export interface PackageJson {
  name?: string;
  version?: string;
  type?: string;
  packageManager?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

export interface Framework {
  id: "react" | "svelte";
  label: string;
  detect: string[];
  plugins: string[];
  sampleFile: string;
}

/** Flat config file names, in the order ESLint looks for them. */
export const FLAT_CONFIG_FILES = [
  "eslint.config.js",
  "eslint.config.mjs",
  "eslint.config.cjs",
  "eslint.config.ts",
  "eslint.config.mts",
  "eslint.config.cts",
];

export const LEGACY_CONFIG_FILES = [
  ".eslintrc",
  ".eslintrc.js",
  ".eslintrc.cjs",
  ".eslintrc.json",
  ".eslintrc.yaml",
  ".eslintrc.yml",
];

export const PRETTIER_CONFIG_FILES = [
  ".prettierrc",
  ".prettierrc.json",
  ".prettierrc.yaml",
  ".prettierrc.yml",
  ".prettierrc.js",
  ".prettierrc.cjs",
  ".prettierrc.mjs",
  "prettier.config.js",
  "prettier.config.cjs",
  "prettier.config.mjs",
];

export const FRAMEWORKS: Framework[] = [
  {
    id: "react",
    label: "React",
    detect: ["react", "next", "@remix-run/react", "react-router"],
    plugins: ["@eslint-react/eslint-plugin", "eslint-plugin-react-refresh"],
    sampleFile: "index.tsx",
  },
  {
    id: "svelte",
    label: "Svelte",
    detect: ["svelte", "@sveltejs/kit"],
    plugins: ["eslint-plugin-svelte", "svelte-eslint-parser"],
    sampleFile: "App.svelte",
  },
];

const LOCKFILES: [string, PackageManager][] = [
  ["pnpm-lock.yaml", "pnpm"],
  ["pnpm-workspace.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["package-lock.json", "npm"],
];



/**
 * @description
 * Walks up from a directory until the predicate matches a directory.
 *
 * @param cwd - Directory to start from.
 * @param match - Returns a value for a matching directory, undefined otherwise.
 * @returns The first matched value, or undefined.
 */
export function findUp<T>(cwd: string, match: (dir: string) => T | undefined): T | undefined {
  let dir = path.resolve(cwd);

  while (true) {
    const found = match(dir);

    if (found !== undefined) {
      return found;
    }

    const parent = path.dirname(dir);

    if (parent === dir) {
      return undefined;
    }

    dir = parent;
  }
}

/**
 * @description
 * Finds the flat config file ESLint would use, searching the directory and its parents.
 *
 * @param cwd - Directory to start from.
 * @returns Absolute path of the config file, or undefined.
 */
export function findFlatConfig(cwd: string): string | undefined {
  return findUp(cwd, dir => FLAT_CONFIG_FILES
    .map(name => path.join(dir, name))
    .find(file => existsSync(file)));
}

/**
 * @description
 * Lists the files from a set of names that exist in a directory.
 *
 * @param cwd - Directory to look into.
 * @param names - File names to check.
 * @returns The existing file names.
 */
export function existingFiles(cwd: string, names: string[]): string[] {
  return names.filter(name => existsSync(path.join(cwd, name)));
}

/**
 * @description
 * Reads and parses a package.json file.
 *
 * @param file - Path to the package.json file.
 * @returns The parsed manifest, or undefined when missing or invalid.
 */
export function readPackageJson(file: string): PackageJson | undefined {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as PackageJson;
  }
  catch {
    return undefined;
  }
}

/**
 * @description
 * Finds the nearest package.json.
 *
 * @param cwd - Directory to start from.
 * @returns The path and parsed manifest, or undefined.
 */
export function findPackageJson(cwd: string): { file: string; pkg: PackageJson } | undefined {
  return findUp(cwd, (dir) => {
    const file = path.join(dir, "package.json");
    const pkg = existsSync(file) ? readPackageJson(file) : undefined;

    return pkg ? { file, pkg } : undefined;
  });
}

/**
 * @description
 * Collects every dependency name declared in a manifest.
 *
 * @param pkg - The manifest.
 * @returns A set of dependency names.
 */
export function dependencyNames(pkg: PackageJson | undefined): Set<string> {
  return new Set([
    ...Object.keys(pkg?.dependencies ?? {}),
    ...Object.keys(pkg?.devDependencies ?? {}),
    ...Object.keys(pkg?.peerDependencies ?? {}),
  ]);
}

/**
 * @description
 * Detects the frameworks a project uses from its dependencies.
 *
 * @param pkg - The manifest.
 * @returns The detected frameworks.
 */
export function detectFrameworks(pkg: PackageJson | undefined): Framework[] {
  const deps = dependencyNames(pkg);

  return FRAMEWORKS.filter(framework => framework.detect.some(name => deps.has(name)));
}

/**
 * @description
 * Detects the package manager used by a project.
 *
 * @param cwd - Directory to start from.
 * @returns The package manager name.
 */
export function detectPackageManager(cwd: string): PackageManager {
  const fromField = findPackageJson(cwd)?.pkg.packageManager?.split("@")[0];

  if (fromField === "pnpm" || fromField === "yarn" || fromField === "bun" || fromField === "npm") {
    return fromField;
  }

  return findUp(cwd, dir => LOCKFILES.find(([file]) => existsSync(path.join(dir, file)))?.[1]) ?? "npm";
}

/**
 * @description
 * Builds the command that installs dev dependencies with a package manager.
 *
 * @param manager - The package manager.
 * @param packages - Packages to install.
 * @returns The install command.
 */
export function installCommand(manager: PackageManager, packages: string[]): string {
  const verb = manager === "npm" ? "install -D" : "add -D";

  return `${manager} ${verb} ${packages.join(" ")}`;
}

/**
 * @description
 * Resolves the version of a package installed for a project.
 *
 * @param cwd - Project directory.
 * @param name - Package name.
 * @returns The installed version, or undefined when not resolvable.
 */
export function installedVersion(cwd: string, name: string): string | undefined {
  try {
    const require = createRequire(path.join(path.resolve(cwd), "noop.js"));
    const file = require.resolve(`${name}/package.json`);

    return readPackageJson(file)?.version;
  }
  catch {
    return findUp(cwd, (dir) => {
      const file = path.join(dir, "node_modules", name, "package.json");

      return existsSync(file) ? readPackageJson(file)?.version : undefined;
    });
  }
}
