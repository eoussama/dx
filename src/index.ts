import antfu from "@antfu/eslint-config";



/**
 * @description
 * Personal DX config.
 *
 * @param options - Overriding options.
 * @returns The final config object.
 */
export default function dx(options?: Parameters<typeof antfu>[0]) {
  return antfu({
    pnpm: true,
    typescript: true,

    stylistic: {
      indent: 2,
      semi: true,
      quotes: "double",
    },

    rules: {
      // Linting
      "no-console": "error",
      "pnpm/json-enforce-catalog": "off",

      // Stylistic
      "yaml/indent": "off",
      "curly": "warn",
      "style/curly-newline": "warn",
      "style/no-multiple-empty-lines": ["warn", { max: 3, maxBOF: 0, maxEOF: 1 }],
      "import/newline-after-import": ["warn", { count: 3, exactCount: true, considerComments: true }],
      "@stylistic/padding-line-between-statements": [
        "error",
        { blankLine: "always", prev: "*", next: "return" },
        { blankLine: "always", prev: ["const", "let", "var"], next: "*" },
        { blankLine: "any", prev: ["const", "let", "var"], next: ["const", "let", "var"] },
        { blankLine: "always", prev: "directive", next: "*" },
        { blankLine: "any", prev: "directive", next: "directive" },
        { blankLine: "always", prev: ["case", "default"], next: "*" },
      ],

      // Typescript
      "ts/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-definitions": "off",

      // Documentation
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
      "jsdoc/require-returns": ["warn", {
        forceReturnsWithAsync: true,
      }],
      "jsdoc/require-param-description": ["warn"],
    },

    ...options,
  });
}
