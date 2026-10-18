import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";

import { ESLint } from "eslint";
import dx from "../../src/index.ts";
import { capture, project, root } from "./helpers.mjs";



const BASE_RULES = {
  "no-console": "error",
  "curly": "warn",
  "no-fallthrough": ["error", { allowEmptyCase: true }],
};

const IMPORT_RULES = {
  "import/newline-after-import": ["warn", { count: 3, exactCount: true, considerComments: true }],
};

const JSDOC_RULES = {
  "jsdoc/require-jsdoc": ["warn", {
    publicOnly: true,
    require: {
      ClassDeclaration: true,
      ClassExpression: true,
      ArrowFunctionExpression: true,
      FunctionDeclaration: true,
      FunctionExpression: true,
      MethodDefinition: true,
    },
  }],
  "jsdoc/tag-lines": ["warn", "any", { startLines: 1, count: 1, tags: { param: { lines: "never" }, returns: { lines: "never" } } }],
  "jsdoc/require-description": ["warn", { descriptionStyle: "any" }],
  "jsdoc/require-param": ["warn"],
  "jsdoc/require-returns": ["warn", { forceReturnsWithAsync: true }],
  "jsdoc/require-param-description": ["warn"],
};

const STYLISTIC_RULES = {
  "style/curly-newline": "warn",
  "style/no-multiple-empty-lines": ["warn", { max: 3, maxBOF: 0, maxEOF: 1 }],
  "style/padding-line-between-statements": [
    "error",
    { blankLine: "always", prev: "*", next: "return" },
    { blankLine: "always", prev: ["const", "let", "var"], next: "*" },
    { blankLine: "any", prev: ["const", "let", "var"], next: ["const", "let", "var"] },
    { blankLine: "always", prev: "directive", next: "*" },
    { blankLine: "any", prev: "directive", next: "directive" },
    { blankLine: "always", prev: ["case", "default"], next: "*" },
  ],
};

const TYPESCRIPT_RULES = { "ts/no-explicit-any": "error", "ts/consistent-type-definitions": "off" };
const YAML_RULES = { "yaml/indent": "off" };
const PNPM_RULES = { "pnpm/json-enforce-catalog": "off" };

/**
 * @description
 * Gets the rules dx layers on top of the antfu config.
 *
 * @param options - The dx options.
 * @returns The dx rules.
 */
async function dxRules(options) {
  const items = await dx({ isInEditor: false, ...options });
  const unnamed = items.filter(item => !item.name && item.rules);

  assert.equal(unnamed.length, 1);

  return unnamed[0].rules;
}

/**
 * @description
 * Resolves the rules applied to a file for a dx config.
 *
 * @param config - The dx config composer.
 * @param file - The file, relative to the repository.
 * @returns The resolved rules.
 */
async function rulesFor(config, file = "src/index.ts") {
  const eslint = new ESLint({ cwd: root, overrideConfigFile: true, overrideConfig: await config });

  return (await eslint.calculateConfigForFile(path.join(root, file))).rules;
}

/**
 * @description
 * Runs a task with environment variables set, restoring them afterwards.
 *
 * @param env - Environment variables to set, undefined values are removed.
 * @param task - The task.
 * @returns The task result.
 */
async function withEnv(env, task) {
  const saved = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  const apply = values => Object.entries(values).forEach(([key, value]) => {
    if (value === undefined) {
      delete process.env[key];
    }
    else {
      process.env[key] = value;
    }
  });

  apply(env);

  try {
    return await task();
  }
  finally {
    apply(saved);
  }
}

describe("dx rules", () => {
  it("layers every rule group by default", async () => {
    assert.deepEqual(await dxRules({ pnpm: true }), {
      ...BASE_RULES,
      ...IMPORT_RULES,
      ...JSDOC_RULES,
      ...STYLISTIC_RULES,
      ...TYPESCRIPT_RULES,
      ...YAML_RULES,
      ...PNPM_RULES,
    });
  });

  it("drops the rules of disabled features", async () => {
    assert.deepEqual(await dxRules({ pnpm: false, imports: false, jsdoc: false, stylistic: false, typescript: false, yaml: false }), BASE_RULES);
    assert.deepEqual(Object.keys(await dxRules({ pnpm: false, imports: false })), Object.keys({ ...BASE_RULES, ...JSDOC_RULES, ...STYLISTIC_RULES, ...TYPESCRIPT_RULES, ...YAML_RULES }));
    assert.deepEqual(Object.keys(await dxRules({ pnpm: false, jsdoc: false })), Object.keys({ ...BASE_RULES, ...IMPORT_RULES, ...STYLISTIC_RULES, ...TYPESCRIPT_RULES, ...YAML_RULES }));
    assert.deepEqual(Object.keys(await dxRules({ pnpm: false, typescript: false })), Object.keys({ ...BASE_RULES, ...IMPORT_RULES, ...JSDOC_RULES, ...STYLISTIC_RULES, ...YAML_RULES }));
    assert.deepEqual(Object.keys(await dxRules({ pnpm: false, yaml: false })), Object.keys({ ...BASE_RULES, ...IMPORT_RULES, ...JSDOC_RULES, ...STYLISTIC_RULES, ...TYPESCRIPT_RULES }));
  });

  it("only turns off yaml indentation when stylistic rules are on", async () => {
    assert.deepEqual(Object.keys(await dxRules({ pnpm: false, stylistic: false })), Object.keys({ ...BASE_RULES, ...IMPORT_RULES, ...JSDOC_RULES, ...TYPESCRIPT_RULES }));
  });

  it("keeps the feature rules for truthy feature options", async () => {
    const rules = await dxRules({ pnpm: true, imports: true, jsdoc: {}, typescript: {}, yaml: {} });

    assert.ok("import/newline-after-import" in rules);
    assert.ok("jsdoc/require-jsdoc" in rules);
    assert.ok("ts/no-explicit-any" in rules);
    assert.ok("yaml/indent" in rules);
    assert.ok("pnpm/json-enforce-catalog" in rules);
  });

  it("lets user rules override the defaults", async () => {
    const rules = await dxRules({ pnpm: false, rules: { "curly": "off", "no-console": "warn", "eqeqeq": "error" } });

    assert.equal(rules.curly, "off");
    assert.equal(rules["no-console"], "warn");
    assert.equal(rules.eqeqeq, "error");
  });

  it("detects pnpm workspaces when pnpm is not set", async () => {
    const workspace = project({ "pnpm-workspace.yaml": "" });
    const plain = project();
    const cwd = process.cwd();

    try {
      process.chdir(workspace);
      assert.ok("pnpm/json-enforce-catalog" in await dxRules({}));
      process.chdir(plain);
      assert.ok(!("pnpm/json-enforce-catalog" in await dxRules({})));
    }
    finally {
      process.chdir(cwd);
    }
  });
});

describe("dx config", () => {
  it("merges user rules and stylistic options with the defaults", async () => {
    const rules = await rulesFor(dx({ isInEditor: false, rules: { curly: "off" }, stylistic: { indent: 4 } }));

    assert.equal(rules.curly[0], 0);
    assert.equal(rules["no-console"][0], 2);
    assert.equal(rules["style/quotes"][1], "double");
    assert.equal(rules["style/semi"][1], "always");
    assert.equal(rules["style/indent"][1], 4);
  });

  it("uses the dx stylistic defaults", async () => {
    for (const stylistic of [undefined, true, {}]) {
      const rules = await rulesFor(dx({ isInEditor: false, stylistic }));

      assert.equal(rules["style/indent"][1], 2);
      assert.equal(rules["style/quotes"][1], "double");
      assert.equal(rules["style/semi"][1], "always");
    }
  });

  it("supports disabling stylistic rules", async () => {
    const rules = await rulesFor(dx({ isInEditor: false, stylistic: false }));

    assert.equal(rules["style/padding-line-between-statements"], undefined);
    assert.equal(rules["no-console"][0], 2);
  });

  it("enables typescript by default and lets it be disabled", async () => {
    assert.equal((await rulesFor(dx({ isInEditor: false })))["ts/no-explicit-any"][0], 2);
    assert.equal((await rulesFor(dx({ isInEditor: false, typescript: false }), "src/index.js"))["ts/no-explicit-any"], undefined);
  });

  it("appends user configs", async () => {
    const rules = await rulesFor(dx({ isInEditor: false }, { files: ["**/*.ts"], rules: { "no-console": "off" } }));

    assert.equal(rules["no-console"][0], 0);
  });

  it("lints like CI when run by the dx CLI, even inside an editor", async () => {
    const level = async () => (await rulesFor(dx()))["unused-imports/no-unused-imports"][0];
    const editor = { VSCODE_PID: "1", CI: undefined };

    await capture(async () => {
      assert.equal(await withEnv({ ...editor, DX_CLI: undefined }, level), 1);
      assert.equal(await withEnv({ ...editor, DX_CLI: "0" }, level), 1);
      assert.equal(await withEnv({ ...editor, DX_CLI: "1" }, level), 2);
    });
  });

  it("lets an explicit isInEditor option win over the dx CLI", async () => {
    const rules = await withEnv({ DX_CLI: "1" }, async () => rulesFor(dx({ isInEditor: true })));

    assert.equal(rules["unused-imports/no-unused-imports"][0], 1);
  });
});
