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
      "no-console": "warn",
      "pnpm/json-enforce-catalog": "off",

      // Stylistic
      "yaml/indent": "off",
      "style/no-multiple-empty-lines": ["warn", { max: 3, maxBOF: 0, maxEOF: 1 }],
      "import/newline-after-import": ["warn", { count: 3, exactCount: true, considerComments: true }],

      // Typescript
      "@typescript-eslint/consistent-type-definitions": "off",

      // Documentation
      "jsdoc/require-returns-description": ["warn"],
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
            returns: { lines: "always" },
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
