import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import { ESLint } from "eslint";
import { doctor, isSupportedNode, NODE_RANGE } from "../../src/lib/doctor.ts";
import { project, repo, root } from "./helpers.mjs";



const { version } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const DX_SOURCE = pathToFileURL(path.join(root, "src", "index.ts")).href;

/**
 * @description
 * Builds a fake installed package.
 *
 * @param name - Package name.
 * @param packageVersion - Package version.
 * @returns The files of the package, keyed by relative path.
 */
function installed(name, packageVersion) {
  return { [`node_modules/${name}/package.json`]: JSON.stringify({ name, version: packageVersion }) };
}

/**
 * @description
 * Runs the doctor and indexes its checks by label.
 *
 * @param dir - Project directory.
 * @returns The checks keyed by label.
 */
async function checks(dir) {
  const list = await doctor(dir);

  assert.equal(new Set(list.map(check => check.label)).size, list.length);

  return Object.fromEntries(list.map(check => [check.label, { status: check.status, detail: check.detail }]));
}

describe("isSupportedNode", () => {
  it("requires Node.js 24 or later", () => {
    assert.equal(NODE_RANGE, ">=24");
    assert.equal(isSupportedNode("24.0.0"), true);
    assert.equal(isSupportedNode("25.1.0"), true);
    assert.equal(isSupportedNode("23.99.99"), false);
    assert.equal(isSupportedNode("8.0.0"), false);
    assert.equal(isSupportedNode(""), false);
  });
});

describe("doctor", () => {
  it("reports a bare directory", async () => {
    const dir = project();
    const list = await doctor(dir);

    assert.deepEqual(list.map(check => check.label), ["Node.js", "dx CLI", "package.json", "Package manager", "@eoussama/dx", "ESLint config", "Config loads", "Git"]);
    assert.deepEqual(Object.fromEntries(list.map(check => [check.label, check])), {
      "Node.js": { status: "ok", label: "Node.js", detail: `v${process.versions.node}` },
      "dx CLI": { status: "info", label: "dx CLI", detail: `v${version}, bundled ESLint v${ESLint.version}` },
      "package.json": { status: "warn", label: "package.json", detail: "not found, dx init will write eslint.config.mjs" },
      "Package manager": { status: "info", label: "Package manager", detail: "npm" },
      "@eoussama/dx": { status: "warn", label: "@eoussama/dx", detail: "not installed in this project, run: npm install -D @eoussama/dx" },
      "ESLint config": { status: "warn", label: "ESLint config", detail: "none found, dx lint uses the built-in dx defaults. Run: dx init" },
      "Config loads": { status: "ok", label: "Config loads", detail: "no errors" },
      "Git": { status: "info", label: "Git", detail: "not a repository, --changed/--staged unavailable" },
    });
  });

  it("flags unsupported Node.js versions", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(process.versions, "node");

    Object.defineProperty(process.versions, "node", { ...descriptor, value: "22.1.0" });

    try {
      assert.deepEqual((await checks(project()))["Node.js"], { status: "error", detail: "v22.1.0 (requires >=24)" });
    }
    finally {
      Object.defineProperty(process.versions, "node", descriptor);
    }
  });

  it("reports the package and installed tools", async () => {
    const dir = repo({
      "package.json": "{\"type\":\"module\",\"packageManager\":\"pnpm@10.0.0\"}",
      "eslint.config.js": "// Extends @eoussama/dx.\nexport default [{}];\n",
      ...installed("@eoussama/dx", version),
      ...installed("eslint", ESLint.version),
      ...installed("typescript", "6.0.2"),
    });
    const result = await checks(dir);

    assert.deepEqual(result["package.json"], { status: "ok", detail: "package.json (ESM)" });
    assert.deepEqual(result["Package manager"], { status: "info", detail: "pnpm" });
    assert.deepEqual(result["@eoussama/dx"], { status: "ok", detail: `v${version}` });
    assert.deepEqual(result.eslint, { status: "ok", detail: `v${ESLint.version}` });
    assert.deepEqual(result.TypeScript, { status: "ok", detail: "v6.0.2" });
    assert.deepEqual(result["ESLint config"], { status: "ok", detail: "eslint.config.js" });
    assert.deepEqual(result["Config loads"], { status: "ok", detail: "no errors" });
    assert.deepEqual(result.Git, { status: "ok", detail: "--changed, --staged and --since available" });
  });

  it("warns about mismatched versions", async () => {
    const dir = project({
      "package.json": "{}",
      "pnpm-lock.yaml": "",
      ...installed("@eoussama/dx", "0.0.1"),
      ...installed("eslint", "9.1.0"),
      ...installed("typescript", "7.0.2"),
    });
    const result = await checks(dir);

    assert.deepEqual(result["package.json"], { status: "ok", detail: "package.json (CommonJS)" });
    assert.deepEqual(result["@eoussama/dx"], { status: "info", detail: `v0.0.1 (CLI is v${version})` });
    assert.deepEqual(result.eslint, { status: "warn", detail: `project has v9.1.0, dx uses v${ESLint.version}` });
    assert.deepEqual(result.TypeScript, {
      status: "warn",
      detail: "v7.0.2 has no JS API, typescript-eslint needs TypeScript 6 installed as \"typescript\". Run: pnpm add -D typescript@npm:@typescript/typescript6@^6 @typescript/native@npm:typescript@^7",
    });
  });

  it("finds the manifest and config in parent directories", async () => {
    const dir = project({ "package.json": "{}", "eslint.config.mjs": "export default [{}];\n", "packages/app/.keep": "" });
    const result = await checks(path.join(dir, "packages", "app"));

    assert.deepEqual(result["package.json"], { status: "ok", detail: `${path.join("..", "..", "package.json")} (CommonJS)` });
    assert.deepEqual(result["ESLint config"], { status: "warn", detail: `${path.join("..", "..", "eslint.config.mjs")} does not import @eoussama/dx` });
  });

  it("reports configs that fail to load", async () => {
    const dir = project({ "eslint.config.mjs": "throw new Error(\"first line\\nsecond line\");\n" });
    const result = await checks(dir);

    assert.deepEqual(result["Config loads"], { status: "error", detail: "first line" });
  });

  it("warns about legacy and prettier configs", async () => {
    const dir = project({ ".eslintrc": "", ".eslintrc.json": "", ".prettierrc": "", "prettier.config.mjs": "" });
    const result = await checks(dir);

    assert.deepEqual(result["Legacy config"], { status: "warn", detail: ".eslintrc, .eslintrc.json is ignored by flat config ESLint, remove it" });
    assert.deepEqual(result.Prettier, { status: "warn", detail: ".prettierrc, prettier.config.mjs found, it will fight with dx stylistic rules" });
  });

  it("checks the VS Code settings", async () => {
    assert.deepEqual((await checks(project({ ".vscode/extensions.json": "{}" })))["VS Code"], {
      status: "info",
      detail: "run dx init --vscode to enable fix on save",
    });
    assert.deepEqual((await checks(project({ ".vscode/settings.json": "{}" })))["VS Code"], {
      status: "info",
      detail: "run dx init --vscode to enable fix on save",
    });
    assert.deepEqual((await checks(project({ ".vscode/settings.json": "{\"source.fixAll.eslint\":\"explicit\"}" })))["VS Code"], {
      status: "ok",
      detail: "fix on save configured",
    });
  });

  it("mentions pnpm workspaces", async () => {
    assert.deepEqual((await checks(project({ "pnpm-workspace.yaml": "" })))["pnpm workspace"], { status: "info", detail: "catalog rules enabled" });
  });

  it("reports detected frameworks that are not enabled", async () => {
    const dir = project({ "package.json": "{\"dependencies\":{\"react\":\"1\",\"svelte\":\"1\"}}", "yarn.lock": "" });
    const result = await checks(dir);

    assert.deepEqual(result.React, {
      status: "info",
      detail: "detected but not enabled, use dx({ react: true }), install: yarn add -D @eslint-react/eslint-plugin eslint-plugin-react-refresh",
    });
    assert.deepEqual(result.Svelte, {
      status: "info",
      detail: "detected but not enabled, use dx({ svelte: true }), install: yarn add -D eslint-plugin-svelte svelte-eslint-parser",
    });
  });

  it("reports enabled frameworks and their missing plugins", async () => {
    const dir = project({
      "package.json": "{\"dependencies\":{\"react\":\"1\",\"svelte\":\"1\"}}",
      "eslint.config.mjs": `import dx from ${JSON.stringify(DX_SOURCE)};\nexport default dx({ react: true, svelte: true });\n`,
      ...installed("@eslint-react/eslint-plugin", "1.0.0"),
      ...installed("eslint-plugin-react-refresh", "1.0.0"),
      ...installed("eslint-plugin-svelte", "1.0.0"),
    });
    const result = await checks(dir);

    assert.deepEqual(result["Config loads"], { status: "ok", detail: "no errors" });
    assert.deepEqual(result.React, { status: "ok", detail: "enabled" });
    assert.deepEqual(result.Svelte, { status: "warn", detail: "enabled, install: npm install -D svelte-eslint-parser" });
  });

  it("does not report frameworks as enabled when the config ignores their files", async () => {
    const dir = project({
      "package.json": "{\"dependencies\":{\"react\":\"1\"}}",
      "eslint.config.mjs": `import dx from ${JSON.stringify(DX_SOURCE)};\nexport default [...await dx({ react: true }), { ignores: ["**/*.tsx"] }];\n`,
    });
    const result = await checks(dir);

    assert.deepEqual(result["Config loads"], { status: "ok", detail: "no errors" });
    assert.match(result.React.detail, /^detected but not enabled/);
  });

  it("loads the config like the dx CLI", async () => {
    delete process.env.DX_CLI;

    await doctor(project());

    assert.equal(process.env.DX_CLI, "1");
  });

  it("does not report frameworks as enabled when the config fails to load", async () => {
    const dir = project({ "package.json": "{\"dependencies\":{\"react\":\"1\"}}", "eslint.config.mjs": "throw new Error(\"broken\");\n" });
    const result = await checks(dir);

    assert.equal(result["Config loads"].status, "error");
    assert.match(result.React.detail, /^detected but not enabled/);
  });
});
