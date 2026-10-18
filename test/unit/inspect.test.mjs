import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, it, mock } from "node:test";



const spawned = [];

mock.module("node:child_process", {
  exports: {
    spawn: (command, args, options) => {
      const child = new EventEmitter();

      spawned.push({ command, args, options, child });

      return child;
    },
  },
});

const { inspect } = await import("../../src/lib/inspect.ts");

/**
 * @description
 * Starts the inspector and returns the spawned child.
 *
 * @param cwd - Project directory.
 * @returns The inspect promise and the fake child process.
 */
function start(cwd = "/project") {
  const promise = inspect(cwd);

  return { promise, ...spawned.at(-1) };
}

describe("inspect", () => {
  it("runs the bundled ESLint config inspector in the project", async () => {
    const { promise, command, args, options, child } = start("/project");

    assert.equal(command, process.execPath);
    assert.equal(args.length, 2);
    assert.ok(args[0].endsWith(path.join("eslint", "bin", "eslint.js")));
    assert.ok(existsSync(args[0]));
    assert.equal(args[1], "--inspect-config");
    assert.equal(options.cwd, "/project");
    assert.equal(options.stdio, "inherit");
    assert.equal(options.env.DX_CLI, "1");
    assert.equal(options.env.PATH ?? options.env.Path, process.env.PATH ?? process.env.Path);

    child.emit("close", 0);

    assert.equal(await promise, 0);
  });

  it("returns the exit code of the inspector", async () => {
    const failed = start();

    failed.child.emit("close", 3);
    assert.equal(await failed.promise, 3);

    const killed = start();

    killed.child.emit("close", null);
    assert.equal(await killed.promise, 0);
  });

  it("fails when the inspector cannot start", async () => {
    const { promise, child } = start();

    child.emit("error", new Error("spawn failed"));

    assert.equal(await promise, 1);
  });

  it("ignores Ctrl+C while the inspector runs", async () => {
    const before = process.listenerCount("SIGINT");
    const { promise, child } = start();

    assert.equal(process.listenerCount("SIGINT"), before + 1);
    assert.doesNotThrow(() => process.listeners("SIGINT").at(-1)());

    child.emit("close", 0);
    await promise;

    assert.equal(process.listenerCount("SIGINT"), before);
  });
});
