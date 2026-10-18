import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { c, createColors, duration, errorMessage, log, plural, print, printError, supportsColor } from "../../src/lib/term.ts";
import { capture } from "./helpers.mjs";



describe("colors", () => {
  it("leaves text untouched when colors are disabled", () => {
    assert.equal(c.red("text"), "text");
    assert.equal(c.bold(42), "42");

    for (const paint of Object.values(createColors(false))) {
      assert.equal(paint("x"), "x");
    }
  });

  it("wraps text in the ANSI codes of each color when enabled", () => {
    const colors = createColors(true);

    assert.deepEqual(Object.fromEntries(Object.entries(colors).map(([name, paint]) => [name, paint("x")])), {
      bold: "\u001B[1mx\u001B[22m",
      dim: "\u001B[2mx\u001B[22m",
      red: "\u001B[31mx\u001B[39m",
      green: "\u001B[32mx\u001B[39m",
      yellow: "\u001B[33mx\u001B[39m",
      blue: "\u001B[34mx\u001B[39m",
      cyan: "\u001B[36mx\u001B[39m",
      gray: "\u001B[90mx\u001B[39m",
    });
    assert.equal(colors.red(7), "\u001B[31m7\u001B[39m");
  });

  it("detects colors from the terminal and the environment", () => {
    assert.equal(supportsColor({}, true), true);
    assert.equal(supportsColor({ TERM: "xterm" }, true), true);
    assert.equal(supportsColor({ TERM: "dumb" }, true), false);
    assert.equal(supportsColor({}, false), false);
    assert.equal(supportsColor({}, undefined), false);
    assert.equal(supportsColor({ NO_COLOR: "" }, true), false);
    assert.equal(supportsColor({ NO_COLOR: "1", FORCE_COLOR: "1" }, true), false);
    assert.equal(supportsColor({ FORCE_COLOR: "0", TERM: "dumb" }, false), true);
    assert.equal(supportsColor({ FORCE_COLOR: "" }, undefined), true);
  });
});

describe("output", () => {
  it("prints lines to stdout and stderr", async () => {
    const { stdout, stderr } = await capture(() => {
      print("out");
      print();
      printError("err");
      printError();
    });

    assert.equal(stdout, "out\n\n");
    assert.equal(stderr, "err\n\n");
  });

  it("prefixes log messages and keeps stdout clean", async () => {
    const { stdout, stderr } = await capture(() => Object.values(log).forEach(write => write("message")));

    assert.equal(stdout, "");
    assert.deepEqual(stderr.split("\n"), [
      "info  message",
      "done  message",
      "warn  message",
      "error message",
      "fail  message",
      "hint  message",
      "",
    ]);
  });
});

describe("formatting", () => {
  it("pluralizes words", () => {
    assert.equal(plural(0, "file"), "0 files");
    assert.equal(plural(1, "file"), "1 file");
    assert.equal(plural(2, "file"), "2 files");
  });

  it("formats durations", () => {
    assert.equal(duration(0), "0ms");
    assert.equal(duration(12.4), "12ms");
    assert.equal(duration(999.4), "999ms");
    assert.equal(duration(999.6), "1000ms");
    assert.equal(duration(1000), "1.00s");
    assert.equal(duration(1234), "1.23s");
  });

  it("extracts error messages", () => {
    assert.equal(errorMessage(new TypeError("boom")), "boom");
    assert.equal(errorMessage("text"), "text");
    assert.equal(errorMessage(42), "42");
    assert.equal(errorMessage({ message: "not an error" }), "[object Object]");
  });
});
