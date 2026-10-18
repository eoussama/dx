import assert from "node:assert/strict";
import * as childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, mock } from "node:test";

import { BAD, capture, FIXABLE, GOOD, inDir, project, repo, root, WARNING } from "./helpers.mjs";



// The sources are not mocked, so their coverage stays intact: the menu runs against fake
// prompts and the config inspector against a fake process.
const calls = [];

mock.module("node:child_process", {
  exports: {
    ...childProcess,
    spawn: (command, args, options) => {
      const child = new EventEmitter();

      calls.push(["spawn", args.at(-1), options.cwd]);
      setImmediate(() => child.emit("close", 5));

      return child;
    },
  },
});

mock.module("@clack/prompts", {
  exports: {
    isCancel: () => false,
    intro: () => calls.push(["intro"]),
    outro: () => {},
    log: { message: () => {} },
    select: async () => "exit",
  },
});

const { main, run } = await import("../../src/lib/main.ts");
const { version } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));

/**
 * @description
 * Runs the CLI in a directory.
 *
 * @param args - CLI arguments.
 * @param cwd - Working directory.
 * @returns The exit code and output.
 */
async function dx(args, cwd = root) {
  const { result, stdout, stderr } = await inDir(cwd, () => capture(() => run(args)));

  return { status: result, stdout, stderr };
}

/**
 * @description
 * Sets whether stdin and stdout are terminals while a task runs.
 *
 * @param stdin - Whether stdin is a terminal.
 * @param stdout - Whether stdout is a terminal.
 * @param task - The task.
 * @returns The task result.
 */
async function withTTY(stdin, stdout, task) {
  const streams = [[process.stdin, stdin], [process.stdout, stdout]];
  const saved = streams.map(([stream]) => Object.getOwnPropertyDescriptor(stream, "isTTY"));

  streams.forEach(([stream, value]) => Object.defineProperty(stream, "isTTY", { value, configurable: true, writable: true }));

  try {
    return await task();
  }
  finally {
    streams.forEach(([stream], index) => saved[index] ? Object.defineProperty(stream, "isTTY", saved[index]) : delete stream.isTTY);
  }
}

describe("help and version", () => {
  it("prints the version", async () => {
    for (const flag of ["-v", "--version"]) {
      assert.deepEqual(await dx([flag]), { status: 0, stdout: `${version}\n`, stderr: "" });
    }
  });

  it("prints the help", async () => {
    const { status, stdout, stderr } = await dx(["--help"]);

    assert.equal(status, 0);
    assert.equal(stderr, "");
    assert.match(stdout, new RegExp(`^dx v${version.replaceAll(".", "\\.")} - personal linting toolkit\n`));
    assert.match(stdout, /\nUsage\n {2}dx {22}Open the interactive menu\n/);
    assert.match(stdout, /\nCommands\n {2}lint \[paths\.\.\.\]/);
    assert.match(stdout, /\nOptions\n {2}-h, --help /);
    assert.match(stdout, /Run dx <command> --help for command options\.\n$/);

    for (const flag of ["-h", "help"]) {
      assert.deepEqual(await dx([flag]), { status, stdout, stderr });
    }
  });

  it("prints the help without a terminal, and opens the menu with one", async () => {
    const help = (await dx(["--help"])).stdout;

    assert.deepEqual(await withTTY(false, false, () => dx([])), { status: 0, stdout: help, stderr: "" });
    assert.deepEqual(await withTTY(true, false, () => dx([])), { status: 0, stdout: help, stderr: "" });
    assert.deepEqual(await withTTY(false, true, () => dx([])), { status: 0, stdout: help, stderr: "" });
    assert.equal(calls.filter(([name]) => name === "intro").length, 0);

    const dir = project();

    assert.equal((await withTTY(true, true, () => dx([], dir))).status, 0);
    assert.deepEqual(calls.at(-1), ["intro"]);
  });

  it("rejects unknown commands", async () => {
    const { status, stdout, stderr } = await dx(["nope"]);

    assert.equal(status, 2);
    assert.equal(stderr, "error Unknown command \"nope\".\n");
    assert.equal(stdout, (await dx(["--help"])).stdout);
  });

  it("prints the help of each command", async () => {
    const expected = {
      lint: /^dx lint \[paths\.\.\.\] \[options\]\n[\s\S]*\nOptions\n {2}--fix [\s\S]*--max-warnings <n>[\s\S]*\nExit codes\n {2}0 no errors, 1 lint errors or too many warnings, 2 fatal error\n$/,
      fix: /^dx lint \[paths\.\.\.\] \[options\]\n/,
      init: /^dx init \[options\]\n\nCreates eslint\.config\.js in ESM packages[\s\S]*\nOptions\n {2}--force [\s\S]*--svelte {16}Enable Svelte rules\n {2}-h, --help {14}Show this help\n$/,
      doctor: /^dx doctor\n\nChecks Node\.js, installed packages, the ESLint config and editor setup\.\nExits with 1 when a check fails\.\n$/,
      inspect: /^dx inspect\n\nOpens @eslint\/config-inspector for the project's ESLint config\.\n$/,
    };

    for (const [command, pattern] of Object.entries(expected)) {
      for (const flag of ["-h", "--help"]) {
        const { status, stdout, stderr } = await dx([command, flag]);

        assert.equal(status, 0);
        assert.equal(stderr, "");
        assert.match(stdout, pattern);
      }
    }
  });

  it("rejects unknown options", async () => {
    for (const command of ["lint", "fix", "init", "doctor", "inspect"]) {
      const { status, stderr } = await dx([command, "--nope"]);

      assert.equal(status, 2);
      assert.match(stderr, /^error Unknown option '--nope'/);
    }
  });

  it("throws unexpected errors from main", async () => {
    await assert.rejects(inDir(root, () => capture(() => main(["lint", "--nope"]))), { code: "ERR_PARSE_ARGS_UNKNOWN_OPTION" });
  });
});

describe("lint command", () => {
  it("lints the working directory", async () => {
    const dir = project({ "bad.js": BAD });
    const { status, stdout, stderr } = await dx(["lint"], dir);

    assert.equal(status, 1);
    assert.match(stdout, /no-console/);
    assert.match(stderr, /built-in dx defaults/);
  });

  it("lints the given paths only", async () => {
    const dir = project({ "bad.js": BAD, "good.js": GOOD });

    assert.equal((await dx(["lint", "good.js"], dir)).status, 0);
    assert.equal((await dx(["lint", "good.js", "bad.js"], dir)).status, 1);
  });

  it("fixes with fix and lint --fix", async () => {
    for (const args of [["fix"], ["lint", "--fix"]]) {
      const dir = project({ "fixable.js": FIXABLE });

      assert.equal((await dx(args, dir)).status, 0);
      assert.equal(readFileSync(path.join(dir, "fixable.js"), "utf8"), "export const value = \"a\";\n");
    }

    const dir = project({ "fixable.js": FIXABLE });

    assert.equal((await dx(["lint"], dir)).status, 1);
    assert.equal(readFileSync(path.join(dir, "fixable.js"), "utf8"), FIXABLE);
  });

  it("passes the reporting options through", async () => {
    const dir = project({ "warning.js": WARNING, "bad.js": BAD });
    const json = await dx(["lint", "--format", "json", "--quiet"], dir);

    assert.equal(json.status, 1);
    assert.deepEqual(JSON.parse(json.stdout).map(result => path.basename(result.filePath)), ["bad.js"]);

    assert.equal((await dx(["lint", "warning.js", "--max-warnings", "1"], dir)).status, 0);
    assert.equal((await dx(["lint", "warning.js", "--max-warnings", "0"], dir)).status, 1);
    assert.equal((await dx(["lint", "--cache", "good.js"], project({ "good.js": GOOD }))).status, 0);
  });

  it("validates --max-warnings", async () => {
    for (const value of ["many", "1.5", "-"]) {
      const { status, stderr } = await dx(["lint", "--max-warnings", value]);

      assert.equal(status, 2);
      assert.equal(stderr, `error --max-warnings expects an integer, got "${value}".\n`);
    }
  });

  it("lints git scopes", async () => {
    const dir = repo({ "committed.js": BAD });

    assert.equal((await dx(["lint", "--changed"], dir)).status, 0);
    assert.equal((await dx(["lint", "--staged"], dir)).status, 0);
    assert.equal((await dx(["lint", "--since", "HEAD"], dir)).status, 0);
    assert.equal((await dx(["lint", "--staged"], project())).status, 2);
  });

  it("rejects paths combined with a git scope, and combined scopes", async () => {
    for (const scope of [["--changed"], ["--staged"], ["--since", "main"]]) {
      assert.deepEqual(await dx(["lint", "a.js", ...scope]), {
        status: 2,
        stdout: "",
        stderr: "error Paths cannot be combined with --changed, --staged or --since.\n",
      });
    }

    assert.deepEqual(await dx(["lint", "--changed", "--staged"]), {
      status: 2,
      stdout: "",
      stderr: "error --changed, --staged and --since cannot be combined.\n",
    });
  });
});

describe("init command", () => {
  it("writes the config and lists the missing packages", async () => {
    const dir = project({ "package.json": "{\"type\":\"module\"}", "pnpm-lock.yaml": "" });
    const { status, stdout, stderr } = await dx(["init", "--react", "--svelte", "--scripts", "--vscode"], dir);

    assert.equal(status, 0);
    assert.equal(stdout, "");
    assert.equal(stderr, [
      "done  Wrote eslint.config.js",
      "done  Wrote package.json",
      `done  Wrote ${path.join(".vscode", "settings.json")}`,
      "hint  Install the missing packages: pnpm add -D @eoussama/dx @eslint-react/eslint-plugin eslint-plugin-react-refresh eslint-plugin-svelte svelte-eslint-parser",
      "hint  Run `dx lint` to check your code.",
      "",
    ].join("\n"));
    assert.match(readFileSync(path.join(dir, "eslint.config.js"), "utf8"), /react: true,\n {2}svelte: true/);
  });

  it("only lists the packages that are not installed", async () => {
    const dir = project({
      "package.json": "{}",
      "node_modules/@eoussama/dx/package.json": "{\"version\":\"1.0.0\"}",
      "node_modules/eslint-plugin-react-refresh/package.json": "{\"version\":\"1.0.0\"}",
    });
    const { stderr } = await dx(["init", "--react"], dir);

    assert.match(stderr, /\nhint {2}Install the missing packages: npm install -D @eslint-react\/eslint-plugin\n/);
  });

  it("does not list packages when everything is installed", async () => {
    const dir = project({ "package.json": "{}", "node_modules/@eoussama/dx/package.json": "{\"version\":\"1.0.0\"}" });
    const { stderr } = await dx(["init", "--scripts"], dir);

    assert.equal(stderr, "done  Wrote eslint.config.mjs\ndone  Wrote package.json\nhint  Run `dx lint` to check your code.\n");
  });

  it("warns about skipped steps", async () => {
    const dir = project({ "package.json": "{\"scripts\":{\"lint\":\"eslint .\"}}" });
    const { stderr } = await dx(["init", "--scripts"], dir);

    assert.match(stderr, /\nwarn {2}Skipped package\.json#scripts\.lint: already set to "eslint \."\n/);
  });

  it("refuses to replace a config without --force", async () => {
    const dir = project({ "eslint.config.mjs": "export default [];\n" });
    const refused = await dx(["init"], dir);

    assert.equal(refused.status, 1);
    assert.equal(refused.stderr, "error eslint.config.mjs already exists. Use --force to replace it (a .bak copy is kept).\n");

    const forced = await dx(["init", "--force"], dir);

    assert.equal(forced.status, 0);
    assert.match(forced.stderr, /^done {2}Moved eslint\.config\.mjs to eslint\.config\.mjs\.bak\ndone {2}Wrote eslint\.config\.mjs\n/);
    assert.ok(existsSync(path.join(dir, "eslint.config.mjs.bak")));
  });

  it("reports unexpected init failures as fatal", async () => {
    const dir = project({ "package.json": "{", "eslint.config.mjs": "" });
    const { status, stderr } = await dx(["init", "--force", "--scripts"], dir);

    assert.equal(status, 2);
    assert.match(stderr, /^error .*JSON/);
  });
});

describe("doctor command", () => {
  it("prints the checks", async () => {
    const dir = project();
    const { status, stdout } = await dx(["doctor"], dir);

    assert.equal(status, 0);
    assert.match(stdout, /^ok {4}Node\.js {10}v\d+/);
    assert.match(stdout, /\nwarn {2}ESLint config {4}none found/);
    assert.equal(stdout.split("\n").length, 9);
  });

  it("fails when a check fails", async () => {
    const dir = project({ "eslint.config.mjs": "throw new Error(\"broken\");\n" });
    const { status, stdout } = await dx(["doctor"], dir);

    assert.equal(status, 1);
    assert.match(stdout, /\nerror Config loads {5}broken\n/);
  });
});

describe("inspect command", () => {
  it("needs a config file", async () => {
    const dir = project();

    assert.deepEqual(await dx(["inspect"], dir), {
      status: 1,
      stdout: "",
      stderr: "error No ESLint config file found. Run `dx init` first.\n",
    });
  });

  it("opens the inspector for the project", async () => {
    const dir = project({ "eslint.config.mjs": "export default [];\n" });

    assert.equal((await dx(["inspect"], dir)).status, 5);
    assert.deepEqual(calls.at(-1), ["spawn", "--inspect-config", dir]);
  });
});
