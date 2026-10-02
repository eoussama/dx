<p align="center">
  <img width="100" alt="dx logo" src="https://github.com/eoussama/dx/blob/main/assets/logo.png?raw=true">
</p>

<p align="center">Personal ESLint config and linting CLI.</p>

<p align="center">
    <a href="https://github.com/eoussama/dx/blob/main/LICENSE" target="_blank"><img alt="License" src="https://img.shields.io/github/license/eoussama/dx" /></a>
    <a href="https://github.com/eoussama/dx/actions/workflows/publish.yml" target="_blank"><img alt="Publish workflow status" src="https://github.com/eoussama/dx/actions/workflows/publish.yml/badge.svg" /></a>
    <a href="https://www.npmjs.com/package/@eoussama/dx" target="_blank"><img alt="npm version" src="https://img.shields.io/npm/v/%40eoussama%2Fdx" /></a>
    <img alt="Code size" src="https://img.shields.io/github/languages/code-size/eoussama/dx" />
</p>

## Description

DX is a personal developer-experience toolkit. It ships an opinionated ESLint flat config built on top of [`@antfu/eslint-config`](https://github.com/antfu/eslint-config), and a `dx` CLI with an interactive menu to lint, fix, set up and diagnose projects.

## Requirements

- Node.js `^20.19.0 || ^22.13.0 || >=24`
- ESLint 10 (installed with dx)

### TypeScript 7

TypeScript 7 ships the native compiler without a JavaScript API, which typescript-eslint still needs. Keep TypeScript 6 installed as `typescript` and add TypeScript 7 under an alias for `tsc`:

```bash
pnpm add -D "typescript@npm:@typescript/typescript6@^6" "@typescript/native@npm:typescript@^7"
```

`dx doctor` warns when a project needs this.

## Installation

```bash
pnpm add -D @eoussama/dx
```

```bash
npm install -D @eoussama/dx
```

```bash
yarn add -D @eoussama/dx
```

## Quick start

```bash
pnpm dx init      # writes eslint.config.js (or .mjs for CommonJS packages)
pnpm dx lint      # lint the project
pnpm dx fix       # lint and apply automatic fixes
```

Running `dx` without arguments opens an interactive menu:

```text
┌  dx v0.1.1
│
│  project my-app
│  config  eslint.config.js
│
◆  What do you want to do?
│  ● Lint project
│  ○ Fix project (apply automatic fixes)
│  ○ Lint changed files (3 files)
│  ○ Fix changed files (3 files)
│  ○ Lint staged files (1 file)
│  ○ Set up ESLint config
│  ○ Doctor (check the project setup)
│  ○ Inspect config (opens in the browser)
│  ○ Exit
└
```

When a project has no ESLint config, `dx lint` falls back to the built-in dx config, so it works in any folder.

## CLI

```text
dx                      Open the interactive menu
dx lint [paths...]      Lint the project, or only the given paths
dx fix [paths...]       Same as lint --fix
dx init                 Create an eslint.config file that uses @eoussama/dx
dx doctor               Check the project setup
dx inspect              Open the ESLint config inspector in the browser
```

### `dx lint`

| Option               | Description                                                    |
| -------------------- | -------------------------------------------------------------- |
| `--fix`              | Apply automatic fixes                                          |
| `--changed`          | Only lint files changed since the last commit, plus untracked  |
| `--staged`           | Only lint staged files, handy in a pre-commit hook             |
| `--since <ref>`      | Only lint files changed since a git ref, for example `main`    |
| `--cache`            | Only re-lint files that changed since the last cached run      |
| `--quiet`            | Report errors only                                             |
| `--max-warnings <n>` | Fail when there are more than `n` warnings                     |
| `--format <name>`    | ESLint formatter, for example `stylish` or `json`              |

Exit codes: `0` no errors, `1` lint errors or too many warnings, `2` fatal error. Status messages go to stderr, so `dx lint --format json > report.json` stays clean.

### `dx init`

| Option      | Description                                                       |
| ----------- | ----------------------------------------------------------------- |
| `--force`   | Replace existing config files (kept as `.bak`) and lint scripts   |
| `--scripts` | Add `lint` and `lint:fix` scripts to `package.json`               |
| `--vscode`  | Add fix-on-save settings to `.vscode/settings.json`               |
| `--react`   | Enable React rules                                                |
| `--svelte`  | Enable Svelte rules                                               |

### `dx doctor`

Checks the Node.js version, installed `@eoussama/dx` and `eslint` versions, the ESLint config (and that it loads), leftover `.eslintrc` or Prettier files, framework plugins and editor settings. It exits with `1` when a check fails.

## Configuration

```js
import dx from "@eoussama/dx";



export default dx();
```

Options are merged on top of the dx defaults, so overriding one rule or one stylistic option keeps everything else:

```js
import dx from "@eoussama/dx";



export default dx({
  // Any @antfu/eslint-config option works here.
  stylistic: {
    indent: 4,
  },
  rules: {
    "no-console": "off",
  },
});
```

Extra flat config items can be passed after the options:

```js
export default dx({}, {
  files: ["scripts/**"],
  rules: {
    "no-console": "off",
  },
});
```

### React and Svelte

Framework support is opt-in. Enable it and install the matching plugins:

```js
export default dx({ react: true });
```

```bash
pnpm add -D @eslint-react/eslint-plugin eslint-plugin-react-refresh
```

```js
export default dx({ svelte: true });
```

```bash
pnpm add -D eslint-plugin-svelte svelte-eslint-parser
```

`dx init --react` / `--svelte` and `dx doctor` print the exact install command for your package manager.

## Development

```bash
git clone https://github.com/eoussama/dx.git
cd dx
pnpm install
pnpm build       # build dist/
pnpm typecheck   # type check the sources
pnpm lint        # lint this repository with its own config
pnpm test        # build and run the CLI smoke tests
```

- The config lives in `src/index.ts`, the CLI in `src/cli.ts` and `src/lib/`.
- For contributing guidelines and documentation standards, see [CONTRIBUTING.md](./CONTRIBUTING.md).
