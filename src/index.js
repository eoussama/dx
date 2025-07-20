import antfu from "@antfu/eslint-config";



/**
 * @description
 * Personal DX config.
 *
 * @param {import("@antfu/eslint-config").Options} [options] Antfu's config options.
 * @returns {import("eslint").Linter.FlatConfig[]} The final config object.
 *
 */
export default function dx(options = {}) {
  return antfu({
    pnpm: true,

    javascript: true,
    typescript: true,

    stylistic: {
      indent: 2,
      semi: true,
      quotes: "double",
    },

    rules: {
      // Linting
      "no-console": "off",
      "pnpm/json-enforce-catalog": "off",

      // Stylistic
      "style/no-multiple-empty-lines": ["error", { max: 3, maxBOF: 0, maxEOF: 1 }],
      "import/newline-after-import": ["warn", { count: 3, exactCount: true, considerComments: true }],

      // Typescript
      "@typescript-eslint/consistent-type-definitions": "off",

      // Documentation
      "jsdoc/require-returns-description": ["error"],
      "jsdoc/require-jsdoc": ["error", {
        publicOnly: true,
        require: {
          FunctionDeclaration: true,
          ClassDeclaration: true,
          MethodDefinition: true,
          ArrowFunctionExpression: true,
        },
      }],
      "jsdoc/tag-lines": [
        "error",
        "any",
        {
          startLines: 1,
          count: 1,
          tags: {
            param: { lines: "never" },
            returns: { lines: "always" },
          },
        },
      ],

      "jsdoc/require-description": ["error", { descriptionStyle: "any" }],
      "jsdoc/require-param": ["error"],
      "jsdoc/require-returns": ["error", {
        forceReturnsWithAsync: true,
      }],
      "jsdoc/require-param-description": ["error"],
    },

    ...options,
  });
}
