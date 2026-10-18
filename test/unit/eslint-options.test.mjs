import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { describe, it } from "node:test";

import { createEslintOptions, decodeParams, encodeParams } from "../../src/lib/eslint-options.ts";



const PARAMS = {
  cwd: "/project",
  fix: false,
  cache: false,
  cacheLocation: "/project/.cache",
  quiet: false,
  fromGit: false,
  builtIn: false,
  concurrency: "off",
};

describe("params", () => {
  it("round trips through a URL safe encoding", () => {
    const params = { ...PARAMS, cwd: "/dir with spaces/ünïcode/??>>", fix: true };
    const encoded = encodeParams(params);

    assert.match(encoded, /^[\w-]+$/);
    assert.deepEqual(decodeParams(encoded), params);
    assert.equal(Buffer.from(encoded, "base64url").toString("utf8"), JSON.stringify(params));
  });
});

describe("createEslintOptions", () => {
  it("maps the parameters to ESLint options", async () => {
    assert.deepEqual(await createEslintOptions(PARAMS), {
      cwd: "/project",
      fix: false,
      cache: false,
      cacheLocation: "/project/.cache",
      cacheStrategy: "content",
      concurrency: "off",
      errorOnUnmatchedPattern: true,
      warnIgnored: true,
    });
  });

  it("passes fix, cache and concurrency through", async () => {
    const options = await createEslintOptions({ ...PARAMS, fix: true, cache: true, concurrency: "auto" });

    assert.equal(options.fix, true);
    assert.equal(options.cache, true);
    assert.equal(options.concurrency, "auto");
  });

  it("does not fail on unmatched or ignored git files", async () => {
    const options = await createEslintOptions({ ...PARAMS, fromGit: true });

    assert.equal(options.errorOnUnmatchedPattern, false);
    assert.equal(options.warnIgnored, false);
  });

  it("only keeps errors when quiet", async () => {
    const { ruleFilter } = await createEslintOptions({ ...PARAMS, quiet: true });

    assert.equal(ruleFilter({ ruleId: "a", severity: 2 }), true);
    assert.equal(ruleFilter({ ruleId: "a", severity: 1 }), false);
  });

  it("uses the built-in config instead of a config file", async () => {
    const options = await createEslintOptions({ ...PARAMS, builtIn: true });

    assert.equal(options.overrideConfigFile, true);
    assert.ok(Array.isArray(options.overrideConfig));
    assert.ok(options.overrideConfig.length > 10);
  });
});

describe("options module", () => {
  it("exports nothing without parameters", async () => {
    assert.deepEqual((await import("../../src/eslint-options.ts")).default, {});
  });

  it("exports the options built from the URL parameters", async () => {
    const { default: options } = await import(`../../src/eslint-options.ts?p=${encodeParams(PARAMS)}`);

    assert.deepEqual(options, await createEslintOptions(PARAMS));
  });
});
