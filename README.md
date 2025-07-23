<p align="center">
  <img width="100" src="https://github.com/eoussama/dx/blob/main/assets/logo.png?raw=true">
</p>

<p align="center">Personal developer-experience configs.</p>

<p align="center">
    <img src="https://img.shields.io/github/license/eoussama/dx" />
    <img src="https://github.com/eoussama/dx/actions/workflows/publish.yml/badge.svg" />
    <img src="https://img.shields.io/npm/v/%40eoussama%2Fdx" />
    <img src="https://img.shields.io/github/languages/code-size/eoussama/dx" />
</p>

## Description

DX is a personal developer-experience configuration toolkit. It provides a set of opinionated ESLint, stylistic, and code quality rules to help you maintain consistent, readable, and robust code across my JavaScript and TypeScript projects.

## Installation

Using [pnpm](https://pnpm.io):

```bash
pnpm add @eoussama/dx
```

Or with npm:

```bash
npm install @eoussama/dx
```

Or with yarn:

```bash
yarn add @eoussama/dx
```

## Usage

Create an `eslint.config.js` file at the root of your project:

```js
import dx from "@eoussama/dx";



export default dx();
```

### Overriding Rules or Options (Optional)

You can override any rules or options by passing them to the `dx` function:

```js
import dx from "@eoussama/dx";



export default dx({
  rules: {
    // Override/add rules here
    "no-console": "off",
    "quotes": ["error", "single"],
    // ...
  },
  // You can also override other options, e.g.:
  stylistic: {
    indent: 4,
    semi: false,
  },
});
```

Now you can run the "dx" binary to run the linter.

```bash
pnpm dx
```

## Development

To contribute or run the project locally:

```bash
# 1. Clone the repository
$ git clone https://github.com/eoussama/dx.git
$ cd dx

# 2. Install dependencies (requires pnpm)
$ pnpm install

# 3. Build the project
$ pnpm build
```

- The main configuration is in `src/index.js`.
- For contributing guidelines and documentation standards, see [CONTRIBUTING.md](./CONTRIBUTING.md).
