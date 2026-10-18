import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  dependencyNames,
  detectFrameworks,
  detectPackageManager,
  existingFiles,
  findFlatConfig,
  findPackageJson,
  findUp,
  FLAT_CONFIG_FILES,
  installCommand,
  installedVersion,
  LEGACY_CONFIG_FILES,
  PRETTIER_CONFIG_FILES,
  readPackageJson,
} from "../../src/lib/project.ts";
import { hasPnpmWorkspace } from "../../src/shared.ts";
import { project, root } from "./helpers.mjs";



describe("findUp", () => {
  it("returns the first match walking up", () => {
    const dir = project({ "a/b/c/.keep": "" });
    const visited = [];
    const found = findUp(path.join(dir, "a", "b", "c"), (current) => {
      visited.push(current);

      return current === path.join(dir, "a") ? "found" : undefined;
    });

    assert.equal(found, "found");
    assert.deepEqual(visited, [path.join(dir, "a", "b", "c"), path.join(dir, "a", "b"), path.join(dir, "a")]);
  });

  it("stops at the filesystem root", () => {
    const visited = [];

    assert.equal(findUp("relative", (dir) => {
      visited.push(dir);
    }), undefined);
    assert.equal(visited[0], path.resolve("relative"));
    assert.equal(visited.at(-1), path.parse(path.resolve("relative")).root);
  });

  it("accepts falsy matches other than undefined", () => {
    assert.equal(findUp(root, () => 0), 0);
    assert.equal(findUp(root, () => ""), "");
  });
});

describe("config files", () => {
  it("finds every flat config file name", () => {
    for (const name of ["eslint.config.js", "eslint.config.mjs", "eslint.config.cjs", "eslint.config.ts", "eslint.config.mts", "eslint.config.cts"]) {
      const dir = project({ [name]: "" });

      assert.equal(findFlatConfig(dir), path.join(dir, name));
    }
  });

  it("prefers the file ESLint looks for first, and searches parents", () => {
    const dir = project({ "eslint.config.ts": "", "eslint.config.mjs": "", "nested/deep/.keep": "" });

    assert.equal(findFlatConfig(path.join(dir, "nested", "deep")), path.join(dir, "eslint.config.mjs"));
    assert.equal(findFlatConfig(project()), undefined);
  });

  it("lists existing legacy and prettier config files", () => {
    const legacy = [".eslintrc", ".eslintrc.js", ".eslintrc.cjs", ".eslintrc.json", ".eslintrc.yaml", ".eslintrc.yml"];
    const prettier = [
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
    const dir = project(Object.fromEntries([...legacy, ...prettier].map(name => [name, ""])));

    assert.deepEqual(existingFiles(dir, LEGACY_CONFIG_FILES), legacy);
    assert.deepEqual(existingFiles(dir, PRETTIER_CONFIG_FILES), prettier);
    assert.deepEqual(existingFiles(dir, FLAT_CONFIG_FILES), []);
    assert.deepEqual(existingFiles(project({ ".eslintrc.json": "" }), LEGACY_CONFIG_FILES), [".eslintrc.json"]);
  });
});

describe("package.json", () => {
  it("reads valid manifests only", () => {
    const dir = project({ "valid.json": "{\"name\":\"x\"}", "invalid.json": "{" });

    assert.deepEqual(readPackageJson(path.join(dir, "valid.json")), { name: "x" });
    assert.equal(readPackageJson(path.join(dir, "invalid.json")), undefined);
    assert.equal(readPackageJson(path.join(dir, "missing.json")), undefined);
  });

  it("finds the nearest valid manifest", () => {
    const dir = project({
      "package.json": "{\"name\":\"outer\"}",
      "broken/package.json": "{",
      "inner/package.json": "{\"name\":\"inner\"}",
      "inner/src/.keep": "",
    });

    assert.deepEqual(findPackageJson(path.join(dir, "inner", "src")), { file: path.join(dir, "inner", "package.json"), pkg: { name: "inner" } });
    assert.deepEqual(findPackageJson(path.join(dir, "broken")), { file: path.join(dir, "package.json"), pkg: { name: "outer" } });
  });

  it("collects dependency names", () => {
    assert.deepEqual([...dependencyNames(undefined)], []);
    assert.deepEqual([...dependencyNames({
      dependencies: { a: "1" },
      devDependencies: { b: "1", a: "1" },
      peerDependencies: { c: "1" },
      optionalDependencies: { d: "1" },
    })], ["a", "b", "c"]);
  });
});

describe("frameworks", () => {
  const ids = pkg => detectFrameworks(pkg).map(framework => framework.id);

  it("detects frameworks from any of their packages", () => {
    for (const name of ["react", "next", "@remix-run/react", "react-router"]) {
      assert.deepEqual(ids({ dependencies: { [name]: "1" } }), ["react"]);
    }

    for (const name of ["svelte", "@sveltejs/kit"]) {
      assert.deepEqual(ids({ devDependencies: { [name]: "1" } }), ["svelte"]);
    }

    assert.deepEqual(ids({ peerDependencies: { react: "1", svelte: "1" } }), ["react", "svelte"]);
    assert.deepEqual(ids({ dependencies: { vue: "1" } }), []);
    assert.deepEqual(ids(undefined), []);
  });

  it("describes each framework", () => {
    assert.deepEqual(detectFrameworks({ dependencies: { react: "1", svelte: "1" } }), [
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
    ]);
  });
});

describe("package manager", () => {
  it("reads the packageManager field before the lockfiles", () => {
    for (const manager of ["pnpm", "yarn", "bun", "npm"]) {
      assert.equal(detectPackageManager(project({ "package.json": JSON.stringify({ packageManager: `${manager}@1.0.0` }) })), manager);
    }

    assert.equal(detectPackageManager(project({ "package.json": "{\"packageManager\":\"npm@10.0.0\"}", "yarn.lock": "" })), "npm");
  });

  it("falls back to lockfiles, in priority order", () => {
    const cases = {
      "pnpm-lock.yaml": "pnpm",
      "pnpm-workspace.yaml": "pnpm",
      "yarn.lock": "yarn",
      "bun.lock": "bun",
      "bun.lockb": "bun",
      "package-lock.json": "npm",
    };

    for (const [file, manager] of Object.entries(cases)) {
      assert.equal(detectPackageManager(project({ "package.json": "{\"packageManager\":\"deno@2\"}", [file]: "" })), manager);
    }

    assert.equal(detectPackageManager(project({ "yarn.lock": "", "pnpm-lock.yaml": "" })), "pnpm");
    assert.equal(detectPackageManager(project({ "package-lock.json": "", "bun.lock": "" })), "bun");
  });

  it("searches parent directories and defaults to npm", () => {
    const dir = project({ "yarn.lock": "", "packages/app/.keep": "" });

    assert.equal(detectPackageManager(path.join(dir, "packages", "app")), "yarn");
    assert.equal(detectPackageManager(project()), "npm");
  });

  it("builds install commands", () => {
    assert.equal(installCommand("npm", ["a", "b"]), "npm install -D a b");
    assert.equal(installCommand("pnpm", ["a"]), "pnpm add -D a");
    assert.equal(installCommand("yarn", ["a"]), "yarn add -D a");
    assert.equal(installCommand("bun", ["a"]), "bun add -D a");
  });
});

describe("installed versions", () => {
  it("resolves packages installed for the project", () => {
    const dir = project({
      "node_modules/plain/package.json": "{\"name\":\"plain\",\"version\":\"1.2.3\"}",
      "node_modules/@scope/pkg/package.json": "{\"name\":\"@scope/pkg\",\"version\":\"4.5.6\"}",
      "nested/.keep": "",
    });

    assert.equal(installedVersion(dir, "plain"), "1.2.3");
    assert.equal(installedVersion(path.join(dir, "nested"), "@scope/pkg"), "4.5.6");
    assert.equal(installedVersion(dir, "missing"), undefined);
  });

  it("finds packages that do not export their package.json", () => {
    const dir = project({
      "node_modules/strict/package.json": "{\"name\":\"strict\",\"version\":\"7.0.0\",\"exports\":{\".\":\"./index.js\"}}",
      "node_modules/strict/index.js": "",
      "app/.keep": "",
    });

    mkdirSync(path.join(dir, "app", "node_modules"));

    assert.equal(installedVersion(path.join(dir, "app"), "strict"), "7.0.0");
  });

  it("resolves the project's own package through its exports", () => {
    const dir = project({
      "package.json": JSON.stringify({ name: "self", version: "3.0.0", exports: { "./package.json": "./package.json" } }),
      "src/.keep": "",
    });

    assert.equal(installedVersion(dir, "self"), "3.0.0");
    assert.equal(installedVersion(path.join(dir, "src"), "self"), "3.0.0");
  });

  it("resolves the versions installed in this repository", () => {
    assert.match(installedVersion(root, "eslint"), /^\d+\.\d+\.\d+/);
  });
});

describe("pnpm workspaces", () => {
  it("looks for pnpm-workspace.yaml in the directory and its parents", () => {
    const dir = project({ "pnpm-workspace.yaml": "", "packages/app/.keep": "" });

    assert.equal(hasPnpmWorkspace(dir), true);
    assert.equal(hasPnpmWorkspace(path.join(dir, "packages", "app")), true);
    assert.equal(hasPnpmWorkspace(project()), false);
  });

  it("defaults to the working directory", () => {
    assert.equal(hasPnpmWorkspace(), hasPnpmWorkspace(process.cwd()));
  });
});
