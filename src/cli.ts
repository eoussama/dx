#!/usr/bin/env node

import process from "node:process";
import { parseArgs } from "node:util";

import { version } from "../package.json";
import { describeInitStep, doctorExitCode, formatCheck, resolveScope, runLint } from "./lib/commands";
import { c, errorMessage, log, print } from "./lib/term";



const HELP = `${c.bold("dx")} ${c.gray(`v${version}`)} - personal linting toolkit

${c.bold("Usage")}
  dx                      Open the interactive menu
  dx <command> [options]

${c.bold("Commands")}
  lint [paths...]         Lint the project, or only the given paths
  fix [paths...]          Same as lint --fix
  init                    Create an eslint.config file that uses @eoussama/dx
  doctor                  Check the project setup
  inspect                 Open the ESLint config inspector in the browser

${c.bold("Options")}
  -h, --help              Show help, also works per command
  -v, --version           Show the version

Run ${c.cyan("dx <command> --help")} for command options.`;

const LINT_HELP = `${c.bold("dx lint")} [paths...] [options]

Lints the project with its eslint.config file, or with the built-in dx config
when the project has none.

${c.bold("Options")}
  --fix                   Apply automatic fixes
  --changed               Only lint files changed since the last commit, including untracked ones
  --staged                Only lint staged files
  --since <ref>           Only lint files changed since a git ref, like main
  --cache                 Only re-lint files that changed since the last cached run
  --quiet                 Report errors only
  --max-warnings <n>      Fail when there are more than n warnings
  --format <name>         ESLint formatter, like stylish or json (default: stylish)
  -h, --help              Show this help

${c.bold("Exit codes")}
  0 no errors, 1 lint errors or too many warnings, 2 fatal error`;

const INIT_HELP = `${c.bold("dx init")} [options]

Creates eslint.config.js in ESM packages, or eslint.config.mjs otherwise.

${c.bold("Options")}
  --force                 Replace existing config files (kept as .bak) and scripts
  --scripts               Add lint and lint:fix scripts to package.json
  --vscode                Add fix on save settings to .vscode/settings.json
  --react                 Enable React rules
  --svelte                Enable Svelte rules
  -h, --help              Show this help`;

const DOCTOR_HELP = `${c.bold("dx doctor")}

Checks Node.js, installed packages, the ESLint config and editor setup.
Exits with 1 when a check fails.`;

const INSPECT_HELP = `${c.bold("dx inspect")}

Opens @eslint/config-inspector for the project's ESLint config.`;

/**
 * @description
 * Runs the lint command.
 *
 * @param args - Command arguments.
 * @param fix - Whether fixing is forced by the command name.
 * @returns The exit code.
 */
async function lintCommand(args: string[], fix: boolean): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      "fix": { type: "boolean", default: fix },
      "changed": { type: "boolean" },
      "staged": { type: "boolean" },
      "since": { type: "string" },
      "cache": { type: "boolean" },
      "quiet": { type: "boolean" },
      "max-warnings": { type: "string" },
      "format": { type: "string" },
      "help": { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    print(LINT_HELP);

    return 0;
  }

  const maxWarnings = values["max-warnings"] === undefined ? undefined : Number(values["max-warnings"]);

  if (maxWarnings !== undefined && !Number.isInteger(maxWarnings)) {
    throw new TypeError(`--max-warnings expects an integer, got "${values["max-warnings"]}".`);
  }

  const scope = resolveScope(values);

  if (scope && positionals.length) {
    throw new Error("Paths cannot be combined with --changed, --staged or --since.");
  }

  return runLint({
    cwd: process.cwd(),
    patterns: positionals,
    scope,
    fix: values.fix,
    cache: values.cache,
    quiet: values.quiet,
    maxWarnings,
    format: values.format,
  });
}

/**
 * @description
 * Runs the init command.
 *
 * @param args - Command arguments.
 * @returns The exit code.
 */
async function initCommand(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      force: { type: "boolean" },
      scripts: { type: "boolean" },
      vscode: { type: "boolean" },
      react: { type: "boolean" },
      svelte: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    print(INIT_HELP);

    return 0;
  }

  const { init, InitError } = await import("./lib/init");
  const { detectPackageManager, FRAMEWORKS, installCommand, installedVersion } = await import("./lib/project");
  const cwd = process.cwd();
  const frameworks = FRAMEWORKS.filter(framework => values[framework.id]);

  try {
    const steps = init({
      cwd,
      force: values.force,
      scripts: values.scripts,
      vscode: values.vscode,
      frameworks: frameworks.map(framework => framework.id),
    });

    for (const step of steps) {
      (step.kind === "skipped" ? log.warn : log.success)(describeInitStep(step));
    }
  }
  catch (error) {
    if (error instanceof InitError) {
      log.error(error.message);

      return 1;
    }

    throw error;
  }

  const missing = [
    ...(installedVersion(cwd, "@eoussama/dx") ? [] : ["@eoussama/dx"]),
    ...frameworks.flatMap(framework => framework.plugins).filter(name => !installedVersion(cwd, name)),
  ];

  if (missing.length) {
    log.hint(`Install the missing packages: ${installCommand(detectPackageManager(cwd), missing)}`);
  }

  log.hint("Run `dx lint` to check your code.");

  return 0;
}

/**
 * @description
 * Runs the doctor command.
 *
 * @param args - Command arguments.
 * @returns The exit code.
 */
async function doctorCommand(args: string[]): Promise<number> {
  const { values } = parseArgs({ args, options: { help: { type: "boolean", short: "h" } } });

  if (values.help) {
    print(DOCTOR_HELP);

    return 0;
  }

  const { doctor } = await import("./lib/doctor");
  const checks = await doctor(process.cwd());

  checks.map(formatCheck).forEach(line => print(line));

  return doctorExitCode(checks);
}

/**
 * @description
 * Runs the inspect command.
 *
 * @param args - Command arguments.
 * @returns The exit code.
 */
async function inspectCommand(args: string[]): Promise<number> {
  const { values } = parseArgs({ args, options: { help: { type: "boolean", short: "h" } } });

  if (values.help) {
    print(INSPECT_HELP);

    return 0;
  }

  const { findFlatConfig } = await import("./lib/project");

  if (!findFlatConfig(process.cwd())) {
    log.error("No ESLint config file found. Run `dx init` first.");

    return 1;
  }

  const { inspect } = await import("./lib/inspect");

  return inspect(process.cwd());
}

/**
 * @description
 * Dispatches the command line arguments.
 *
 * @param argv - Arguments without the node and script paths.
 * @returns The exit code.
 */
async function main(argv: string[]): Promise<number> {
  const [command, ...args] = argv;

  switch (command) {
    case undefined:
      if (process.stdin.isTTY && process.stdout.isTTY) {
        const { tui } = await import("./lib/tui");

        return tui(process.cwd());
      }

      print(HELP);

      return 0;

    case "-h":

    case "--help":

    case "help":
      print(HELP);

      return 0;

    case "-v":

    case "--version":
      print(version);

      return 0;

    case "lint":
      return lintCommand(args, false);

    case "fix":
      return lintCommand(args, true);

    case "init":
      return initCommand(args);

    case "doctor":
      return doctorCommand(args);

    case "inspect":
      return inspectCommand(args);

    default:
      log.error(`Unknown command "${command}".`);
      print(HELP);

      return 2;
  }
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    log.error(errorMessage(error));
    process.exitCode = 2;
  });
