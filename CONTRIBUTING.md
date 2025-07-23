# Contributing to DX

Thank you for your interest in contributing to **DX**! We appreciate your help in making the project better.

Before you start contributing, please take a moment to review this guide, which outlines the process for contributing and the community guidelines we follow.

## Code of Conduct

We have a [Code of Conduct](CODE_OF_CONDUCT.md) that we expect all contributors to adhere to. Please read it and make sure you understand and follow it in all your interactions within our project.

## Getting Started

- If you are new to our project, please review our [README](README.md) for an overview of the project and how to get started.

- Check our [Issues](https://github.com/eoussama/dx/issues) to find tasks that need assistance or to report any bugs or feature requests.

## How to Contribute

1. Fork the repository to your GitHub account.

2. Create a new branch for your contribution:

   ```bash
   git checkout -b feat/your-feature-name
   ```

## JSDoc Comment Format

All JavaScript/TypeScript functions, classes, and methods must use the following JSDoc format:

```
/**
* @description
* <content>
*
* @param1 <content>
* @param2 <content>
* @param3 <content>
*
* @returns <content>
*/
```

- The `@description` tag is required and should be followed by a blank line.
- Each `@param` tag should be on its own line, with no blank lines between params.
- The `@returns` tag should be separated from the params by a blank line.
- No extra indentation or spaces before asterisks.
- Example (from `src/index.js`):

```js
/**
 * @description
 * Personal DX config.
 *
 * @param {import("@antfu/eslint-config").Options} [options] Antfu's config options.
 * @returns {import("eslint").Linter.FlatConfig[]} The final config object.
 *
 */
```

The linter will enforce this format as much as possible. See `.eslintrc` for details.
