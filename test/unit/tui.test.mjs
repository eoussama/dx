import assert from "node:assert/strict";
import * as childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, it, mock } from "node:test";

import { BAD, FIXABLE, git, GOOD, project, repo, root } from "./helpers.mjs";



const CANCEL = Symbol("cancel");
const { version } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));

/** Every prompt call, as [name, ...args]. */
let calls = [];

/** Answers given to the prompts, in order. */
let answers = [];

/**
 * @description
 * Records a call and returns the next scripted answer.
 *
 * @param name - The prompt name.
 * @param options - The prompt options.
 * @returns The answer.
 */
async function answer(name, options) {
  calls.push([name, options]);
  assert.ok(answers.length, `no answer left for ${name}: ${options.message}`);

  return answers.shift();
}

/**
 * @description
 * Builds a prompt function that only records its calls.
 *
 * @param name - The prompt name.
 * @returns The prompt function.
 */
function record(name) {
  return (...args) => {
    calls.push([name, ...args]);
  };
}

mock.module("@clack/prompts", {
  exports: {
    CANCEL_SYMBOL: CANCEL,
    isCancel: value => value === CANCEL,
    intro: record("intro"),
    outro: record("outro"),
    select: options => answer("select", options),
    confirm: options => answer("confirm", options),
    multiselect: options => answer("multiselect", options),
    spinner: () => ({ start: record("spinner.start"), stop: record("spinner.stop"), error: record("spinner.error") }),
    log: {
      message: record("log.message"),
      info: record("log.info"),
      warn: record("log.warn"),
      success: record("log.success"),
      error: record("log.error"),
    },
  },
});

mock.module("node:child_process", {
  exports: {
    ...childProcess,
    spawn: (command, args, options) => {
      const child = new EventEmitter();

      calls.push(["inspect", options.cwd]);
      setImmediate(() => child.emit("close", 0));

      return child;
    },
  },
});

const { tui } = await import("../../src/lib/tui.ts");

/**
 * @description
 * Runs the menu with scripted answers, exiting once they are used.
 *
 * @param cwd - Project directory.
 * @param script - The answers to give.
 * @returns The calls after the intro, without the final exit.
 */
async function drive(cwd, script) {
  answers = [...script, "exit"];

  assert.equal(await tui(cwd), 0);
  assert.equal(answers.length, 0);
  assert.deepEqual(calls.at(-1), ["outro", "Done"]);

  return calls.slice(2, -2);
}

const menus = () => calls.filter(([name]) => name === "select").map(([, options]) => options);
const named = name => calls.filter(([call]) => call === name).map(([, ...args]) => args.length === 1 ? args[0] : args);

beforeEach(() => {
  calls = [];
  answers = [];
});

describe("menu", () => {
  it("shows the project and exits", async () => {
    const dir = project({ "package.json": "{\"name\":\"my-app\"}", "eslint.config.mjs": "export default [];\n" });

    assert.deepEqual(await drive(dir, []), []);
    assert.deepEqual(calls.slice(0, 2), [
      ["intro", `dx v${version}`],
      ["log.message", ["project my-app", "config  eslint.config.mjs"]],
    ]);
    assert.equal(menus()[0].message, "What do you want to do?");
    assert.equal(menus()[0].initialValue, "lint");
  });

  it("falls back to the directory name and the built-in config", async () => {
    const dir = project();

    await drive(dir, []);

    assert.deepEqual(calls[1], ["log.message", [`project ${path.basename(dir)}`, "config  none, using built-in dx defaults"]]);
    assert.equal(menus()[0].initialValue, "init");
  });

  it("shows configs found in parent directories", async () => {
    const dir = project({ "eslint.config.js": "export default [];\n", "packages/app/.keep": "" });

    await drive(path.join(dir, "packages", "app"), []);

    assert.deepEqual(calls[1][1][1], `config  ${path.join("..", "..", "eslint.config.js")}`);
  });

  it("exits when cancelled", async () => {
    answers = [CANCEL];

    assert.equal(await tui(project()), 0);
    assert.deepEqual(calls.at(-1), ["outro", "Done"]);
  });

  it("disables the git actions outside of a repository", async () => {
    await drive(project(), []);

    assert.deepEqual(menus()[0].options, [
      { value: "lint", label: "Lint project" },
      { value: "fix", label: "Fix project", hint: "apply automatic fixes" },
      { value: "lint-changed", label: "Lint changed files", hint: "not a git repository", disabled: true },
      { value: "fix-changed", label: "Fix changed files", hint: "not a git repository", disabled: true },
      { value: "lint-staged", label: "Lint staged files", hint: "not a git repository", disabled: true },
      { value: "init", label: "Set up ESLint config", hint: "recommended" },
      { value: "doctor", label: "Doctor", hint: "check the project setup" },
      { value: "inspect", label: "Inspect config", hint: "opens in the browser" },
      { value: "exit", label: "Exit" },
    ]);
  });

  it("counts changed and staged files in a repository", async () => {
    const dir = repo({ "eslint.config.mjs": "export default [];\n", "a.js": "" });

    writeFileSync(path.join(dir, "a.js"), "changed");
    writeFileSync(path.join(dir, "b.js"), "");
    git(dir, ["add", "b.js"]);

    await drive(dir, []);

    const options = Object.fromEntries(menus()[0].options.map(option => [option.value, option]));

    assert.deepEqual(options["lint-changed"], { value: "lint-changed", label: "Lint changed files", hint: "2 files", disabled: false });
    assert.deepEqual(options["fix-changed"], { value: "fix-changed", label: "Fix changed files", hint: "2 files", disabled: false });
    assert.deepEqual(options["lint-staged"], { value: "lint-staged", label: "Lint staged files", hint: "1 file", disabled: false });
    assert.equal(options.init.hint, "replace existing");
  });

  it("remembers the last action", async () => {
    const dir = project({ "good.js": GOOD });

    await drive(dir, ["doctor", "lint"]);

    assert.deepEqual(menus().map(menu => menu.initialValue), ["init", "doctor", "lint"]);
  });
});

describe("lint actions", () => {
  it("lints the project and shows the problems", async () => {
    const dir = project({ "bad.js": BAD });
    const steps = await drive(dir, ["lint"]);
    const names = steps.map(([name]) => name);

    assert.deepEqual(names, ["select", "spinner.start", "spinner.error", "log.message", "log.info"]);
    assert.deepEqual(named("spinner.start"), ["Linting project"]);
    assert.match(named("spinner.error")[0], /^\d+ errors? in 1 file \(/);
    assert.ok(named("log.message")[1].some(line => line.includes("no-console")));
    assert.deepEqual(named("log.info"), ["No ESLint config found, used the built-in dx defaults. Run `dx init` to add one."]);
  });

  it("fixes the project", async () => {
    const dir = project({ "eslint.config.mjs": "export default [{ rules: { quotes: [\"error\", \"double\"] } }];\n", "a.js": FIXABLE });
    const steps = await drive(dir, ["fix"]);

    assert.deepEqual(steps.map(([name]) => name), ["select", "spinner.start", "spinner.stop"]);
    assert.deepEqual(named("spinner.start"), ["Fixing project"]);
    assert.match(named("spinner.stop")[0], /^No problems in 2 files, fixed 1 file \(/);
    assert.equal(readFileSync(path.join(dir, "a.js"), "utf8"), "export const value = \"a\"\n");
  });

  it("lints changed and staged files", async () => {
    const dir = repo({ "eslint.config.mjs": "export default [{ rules: { quotes: [\"error\", \"double\"] } }];\n", "a.js": GOOD });

    writeFileSync(path.join(dir, "changed.js"), FIXABLE);
    writeFileSync(path.join(dir, "staged.js"), FIXABLE);
    git(dir, ["add", "staged.js"]);

    await drive(dir, ["lint-staged", "lint-changed", "fix-changed"]);

    assert.deepEqual(named("spinner.start"), ["Linting staged files", "Linting changed files", "Fixing changed files"]);
    assert.match(named("spinner.error")[0], /^1 error in 1 file/);
    assert.match(named("spinner.error")[1], /^2 errors in 2 files/);
    assert.match(named("spinner.stop")[0], /^No problems in 2 files, fixed 2 files/);
    assert.equal(readFileSync(path.join(dir, "changed.js"), "utf8"), "export const value = \"a\"\n");
  });

  it("warns without failing", async () => {
    const dir = project({ "eslint.config.mjs": "export default [{ rules: { quotes: [\"warn\", \"double\"] } }];\n", "a.js": FIXABLE });

    await drive(dir, ["lint"]);

    assert.match(named("spinner.stop")[0], /^1 warning in 2 files/);
    assert.deepEqual(named("spinner.error"), []);
  });

  it("reports lint failures", async () => {
    const dir = project({ "eslint.config.mjs": "throw new Error(\"broken config\");\n" });

    await drive(dir, ["lint"]);

    assert.deepEqual(named("spinner.error"), ["broken config"]);
    assert.deepEqual(named("log.message").slice(1), []);
  });
});

describe("init action", () => {
  it("sets up a new project", async () => {
    const dir = project({ "package.json": "{\"dependencies\":{\"react\":\"1\"}}", "pnpm-lock.yaml": "" });

    await drive(dir, ["init", ["react"], ["scripts", "vscode"]]);

    const [frameworks, extras] = named("multiselect");

    assert.deepEqual(frameworks, {
      message: "Enable framework support?",
      options: [
        { value: "react", label: "React", hint: "detected" },
        { value: "svelte", label: "Svelte", hint: undefined },
      ],
      initialValues: ["react"],
      required: false,
    });
    assert.deepEqual(extras, {
      message: "Also set up",
      options: [
        { value: "scripts", label: "package.json scripts", hint: "lint and lint:fix" },
        { value: "vscode", label: "VS Code settings", hint: "fix on save, no Prettier" },
      ],
      initialValues: ["scripts"],
      required: false,
    });
    assert.deepEqual(named("confirm"), []);
    assert.deepEqual(named("log.success"), ["Wrote eslint.config.mjs", "Wrote package.json", `Wrote ${path.join(".vscode", "settings.json")}`]);
    assert.deepEqual(named("log.info"), [
      "Install the missing packages:\npnpm add -D @eoussama/dx @eslint-react/eslint-plugin eslint-plugin-react-refresh",
    ]);
    assert.match(readFileSync(path.join(dir, "eslint.config.mjs"), "utf8"), /react: true/);
    assert.ok(existsSync(path.join(dir, ".vscode", "settings.json")));
  });

  it("skips the extras that are not selected", async () => {
    const dir = project({ "package.json": "{}", "node_modules/@eoussama/dx/package.json": "{\"version\":\"1.0.0\"}" });

    await drive(dir, ["init", [], ["vscode"]]);

    assert.deepEqual(named("log.success"), ["Wrote eslint.config.mjs", `Wrote ${path.join(".vscode", "settings.json")}`]);
    assert.deepEqual(named("log.info"), []);
    assert.equal(readFileSync(path.join(dir, "package.json"), "utf8"), "{}");
  });

  it("does not list installed plugins", async () => {
    const dir = project({
      "node_modules/@eoussama/dx/package.json": "{\"version\":\"1.0.0\"}",
      "node_modules/eslint-plugin-svelte/package.json": "{\"version\":\"1.0.0\"}",
    });

    await drive(dir, ["init", ["svelte"], []]);

    assert.deepEqual(named("log.info"), ["Install the missing packages:\nnpm install -D svelte-eslint-parser"]);
  });

  it("only installs the plugins of the selected frameworks", async () => {
    const dir = project({ "node_modules/@eoussama/dx/package.json": "{\"version\":\"1.0.0\"}" });

    await drive(dir, ["init", ["svelte"], []]);

    assert.deepEqual(named("log.info"), ["Install the missing packages:\nnpm install -D eslint-plugin-svelte svelte-eslint-parser"]);
  });

  it("warns about skipped steps", async () => {
    const dir = project({ "package.json": "{\"scripts\":{\"lint\":\"eslint .\"}}" });

    await drive(dir, ["init", [], ["scripts"]]);

    assert.deepEqual(named("log.warn"), ["Skipped package.json#scripts.lint: already set to \"eslint .\""]);
  });

  it("asks before replacing a config", async () => {
    const dir = project({ "eslint.config.mjs": "old" });

    await drive(dir, ["init", false, "init", CANCEL]);

    assert.deepEqual(named("confirm"), [
      { message: "eslint.config.mjs already exists. Replace it? A .bak copy is kept.", initialValue: false },
      { message: "eslint.config.mjs already exists. Replace it? A .bak copy is kept.", initialValue: false },
    ]);
    assert.deepEqual(named("multiselect"), []);
    assert.equal(readFileSync(path.join(dir, "eslint.config.mjs"), "utf8"), "old");

    calls = [];
    await drive(dir, ["init", true, [], []]);

    assert.deepEqual(named("log.success"), ["Moved eslint.config.mjs to eslint.config.mjs.bak", "Wrote eslint.config.mjs"]);
    assert.equal(readFileSync(path.join(dir, "eslint.config.mjs.bak"), "utf8"), "old");
  });

  it("names every config it would replace", async () => {
    const dir = project({ "eslint.config.js": "", "eslint.config.ts": "" });

    await drive(dir, ["init", false]);

    assert.deepEqual(named("confirm").map(options => options.message), [
      "eslint.config.js, eslint.config.ts already exists. Replace it? A .bak copy is kept.",
    ]);
  });

  it("stops when a selection is cancelled", async () => {
    const dir = project();

    await drive(dir, ["init", CANCEL, "init", [], CANCEL]);

    assert.equal(named("multiselect").length, 3);
    assert.deepEqual(named("log.error"), []);
    assert.ok(!existsSync(path.join(dir, "eslint.config.mjs")));
  });

  it("reports init failures", async () => {
    const dir = project({ "package.json": "{" });

    await drive(dir, ["init", [], ["scripts"]]);

    assert.equal(named("log.error").length, 1);
    assert.match(named("log.error")[0], /JSON/);
    assert.deepEqual(named("log.info"), []);
  });
});

describe("doctor action", () => {
  it("summarizes the problems", async () => {
    await drive(project(), ["doctor"]);

    assert.deepEqual(named("spinner.start"), ["Checking project"]);
    assert.deepEqual(named("spinner.stop"), ["Found 3 problems"]);
    assert.match(named("log.message")[1][0], /^ok {4}Node\.js/);
  });

  it("counts errors as problems", async () => {
    await drive(project({ "package.json": "{}", "eslint.config.mjs": "throw new Error(\"broken\");\n" }), ["doctor"]);

    assert.deepEqual(named("spinner.stop"), ["Found 3 problems"]);
  });

  it("reports healthy projects", async () => {
    const dir = project({
      "package.json": "{}",
      "eslint.config.mjs": "// Extends @eoussama/dx.\nexport default [{}];\n",
      "node_modules/@eoussama/dx/package.json": JSON.stringify({ version }),
    });

    await drive(dir, ["doctor"]);

    assert.deepEqual(named("spinner.stop"), ["Everything looks good"]);
  });
});

describe("inspect action", () => {
  it("needs a config file", async () => {
    await drive(project(), ["inspect"]);

    assert.deepEqual(named("log.warn"), ["The config inspector needs an ESLint config file. Run init first."]);
    assert.deepEqual(named("inspect"), []);
  });

  it("opens the inspector", async () => {
    const dir = project({ "eslint.config.mjs": "export default [];\n" });

    await drive(dir, ["inspect"]);

    assert.deepEqual(named("log.info"), ["Starting the config inspector. Press Ctrl+C to come back."]);
    assert.deepEqual(named("inspect"), [dir]);
  });
});
