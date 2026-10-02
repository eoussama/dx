import type { OptionsConfig, StylisticConfig, TypedFlatConfigItem } from "@antfu/eslint-config";
import process from "node:process";

import { antfu } from "@antfu/eslint-config";
import { DX_CLI_ENV, hasPnpmWorkspace } from "./shared";



export type DxOptions = OptionsConfig & Omit<TypedFlatConfigItem, "files">;
export type DxUserConfig = Parameters<typeof antfu>[1];
export type DxRules = NonNullable<TypedFlatConfigItem["rules"]>;

const STYLISTIC_DEFAULTS: StylisticConfig = {
  indent: 2,
  semi: true,
  quotes: "double",
};

const BASE_RULES: DxRules = {
  "no-console": "error",
  "curly": "warn",
  // Grouped cases get blank lines from padding-line-between-statements, which no-fallthrough would flag.
  "no-fallthrough": ["error", { allowEmptyCase: true }],
};

const IMPORT_RULES: DxRules = {
  "import/newline-after-import": ["warn", { count: 3, exactCount: true, considerComments: true }],
};

const JSDOC_RULES: DxRules = {
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
  "jsdoc/tag-lines": [
    "warn",
    "any",
    {
      startLines: 1,
      count: 1,
      tags: {
        param: { lines: "never" },
        returns: { lines: "never" },
      },
    },
  ],
  "jsdoc/require-description": ["warn", { descriptionStyle: "any" }],
  "jsdoc/require-param": ["warn"],
  "jsdoc/require-returns": ["warn", { forceReturnsWithAsync: true }],
  "jsdoc/require-param-description": ["warn"],
};

const STYLISTIC_RULES: DxRules = {
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

const TYPESCRIPT_RULES: DxRules = {
  "ts/no-explicit-any": "error",
  "ts/consistent-type-definitions": "off",
};

const YAML_RULES: DxRules = {
  "yaml/indent": "off",
};

const PNPM_RULES: DxRules = {
  "pnpm/json-enforce-catalog": "off",
};



/**
 * @description
 * Resolves the stylistic options, layering user overrides on top of the dx defaults.
 *
 * @param stylistic - User provided stylistic options.
 * @returns The merged stylistic options, or false when disabled.
 */
function resolveStylistic(stylistic: DxOptions["stylistic"]): DxOptions["stylistic"] {
  if (stylistic === false) {
    return false;
  }

  return {
    ...STYLISTIC_DEFAULTS,
    ...(typeof stylistic === "object" ? stylistic : {}),
  };
}

/**
 * @description
 * Personal DX config.
 * User options are merged on top of the defaults, so overriding a single rule
 * or stylistic option keeps every other dx default in place.
 *
 * @param options - Overriding options.
 * @param userConfigs - Additional flat config items appended after the dx config.
 * @returns The final config composer.
 */
export default function dx(options: DxOptions = {}, ...userConfigs: DxUserConfig[]): ReturnType<typeof antfu> {
  const {
    rules: userRules,
    stylistic: userStylistic,
    ...rest
  } = options;

  const stylistic = resolveStylistic(userStylistic);
  const pnpm = rest.pnpm ?? hasPnpmWorkspace();
  const typescript = rest.typescript ?? true;
  const yaml = rest.yaml ?? true;

  const rules: DxRules = {
    ...BASE_RULES,
    ...(rest.imports !== false ? IMPORT_RULES : {}),
    ...(rest.jsdoc !== false ? JSDOC_RULES : {}),
    ...(stylistic ? STYLISTIC_RULES : {}),
    ...(typescript ? TYPESCRIPT_RULES : {}),
    ...(yaml && stylistic ? YAML_RULES : {}),
    ...(pnpm ? PNPM_RULES : {}),
    ...userRules,
  };

  return antfu({
    // The dx CLI always lints like CI, even when launched from an editor terminal.
    isInEditor: process.env[DX_CLI_ENV] === "1" ? false : undefined,
    ...rest,
    pnpm,
    typescript,
    stylistic,
    rules,
  }, ...userConfigs);
}
