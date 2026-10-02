import type { Framework } from "./project";
import path from "node:path";

import * as p from "@clack/prompts";
import { version } from "../../package.json";
import { describeInitStep, formatCheck, summarizeLint } from "./commands";
import { describeScope, gitFiles, isGitRepo } from "./git";
import {
  detectFrameworks,
  detectPackageManager,
  existingFiles,
  findFlatConfig,
  findPackageJson,
  FLAT_CONFIG_FILES,
  FRAMEWORKS,
  installCommand,
  installedVersion,
} from "./project";
import { c, errorMessage, plural } from "./term";



type Action = "lint" | "fix" | "lint-changed" | "fix-changed" | "lint-staged" | "init" | "doctor" | "inspect" | "exit";

/**
 * @description
 * Runs a lint from the TUI with a spinner and prints the results.
 *
 * @param cwd - Project directory.
 * @param fix - Apply automatic fixes.
 * @param scopeKind - Limit the run to changed or staged files.
 * @returns Resolves once the lint finished.
 */
async function lintAction(cwd: string, fix: boolean, scopeKind?: "changed" | "staged"): Promise<void> {
  const { lint } = await import("./lint");
  const options = { cwd, fix, scope: scopeKind ? { kind: scopeKind } : undefined };
  const spinner = p.spinner();

  spinner.start(`${fix ? "Fixing" : "Linting"} ${options.scope ? describeScope(options.scope) : "project"}`);

  try {
    const report = await lint(options);
    const summary = summarizeLint(report, options);

    if (summary.level === "error") {
      spinner.error(summary.message);
    }
    else {
      spinner.stop(summary.message);
    }

    if (report.output) {
      p.log.message(report.output.split("\n"));
    }

    summary.hints.forEach(hint => p.log.info(hint));
  }
  catch (error) {
    spinner.error(errorMessage(error));
  }
}

/**
 * @description
 * Walks through creating the ESLint config from the TUI.
 *
 * @param cwd - Project directory.
 * @returns Resolves once the config is written or the user backed out.
 */
async function initAction(cwd: string): Promise<void> {
  const existing = existingFiles(cwd, FLAT_CONFIG_FILES);

  if (existing.length) {
    const replace = await p.confirm({
      message: `${existing.join(", ")} already exists. Replace it? A .bak copy is kept.`,
      initialValue: false,
    });

    if (p.isCancel(replace) || !replace) {
      return;
    }
  }

  const pkg = findPackageJson(cwd)?.pkg;
  const detected = detectFrameworks(pkg).map(framework => framework.id);
  const frameworks = await p.multiselect<Framework["id"]>({
    message: "Enable framework support?",
    options: FRAMEWORKS.map(framework => ({
      value: framework.id,
      label: framework.label,
      hint: detected.includes(framework.id) ? "detected" : undefined,
    })),
    initialValues: detected,
    required: false,
  });

  if (p.isCancel(frameworks)) {
    return;
  }

  const extras = await p.multiselect<"scripts" | "vscode">({
    message: "Also set up",
    options: [
      { value: "scripts", label: "package.json scripts", hint: "lint and lint:fix" },
      { value: "vscode", label: "VS Code settings", hint: "fix on save, no Prettier" },
    ],
    initialValues: ["scripts"],
    required: false,
  });

  if (p.isCancel(extras)) {
    return;
  }

  try {
    const { init } = await import("./init");
    const steps = init({
      cwd,
      force: existing.length > 0,
      frameworks,
      scripts: extras.includes("scripts"),
      vscode: extras.includes("vscode"),
    });

    steps.forEach(step => (step.kind === "skipped" ? p.log.warn : p.log.success)(describeInitStep(step)));
  }
  catch (error) {
    p.log.error(errorMessage(error));

    return;
  }

  const manager = detectPackageManager(cwd);
  const missing = [
    ...(installedVersion(cwd, "@eoussama/dx") ? [] : ["@eoussama/dx"]),
    ...FRAMEWORKS
      .filter(framework => frameworks.includes(framework.id))
      .flatMap(framework => framework.plugins)
      .filter(name => !installedVersion(cwd, name)),
  ];

  if (missing.length) {
    p.log.info(`Install the missing packages:\n${c.cyan(installCommand(manager, missing))}`);
  }
}

/**
 * @description
 * Runs the doctor checks from the TUI.
 *
 * @param cwd - Project directory.
 * @returns Resolves once the checks are printed.
 */
async function doctorAction(cwd: string): Promise<void> {
  const { doctor } = await import("./doctor");
  const spinner = p.spinner();

  spinner.start("Checking project");

  const checks = await doctor(cwd);
  const problems = checks.filter(check => check.status === "warn" || check.status === "error").length;

  spinner.stop(problems ? `Found ${plural(problems, "problem")}` : "Everything looks good");
  p.log.message(checks.map(formatCheck));
}

/**
 * @description
 * Opens the ESLint config inspector from the TUI.
 *
 * @param cwd - Project directory.
 * @returns Resolves once the inspector is closed.
 */
async function inspectAction(cwd: string): Promise<void> {
  if (!findFlatConfig(cwd)) {
    p.log.warn("The config inspector needs an ESLint config file. Run init first.");

    return;
  }

  const { inspect } = await import("./inspect");

  p.log.info("Starting the config inspector. Press Ctrl+C to come back.");
  await inspect(cwd);
}

/**
 * @description
 * Interactive menu shown when dx runs without arguments.
 *
 * @param cwd - Project directory.
 * @returns The process exit code.
 */
export async function tui(cwd: string): Promise<number> {
  const configFile = findFlatConfig(cwd);
  const pkg = findPackageJson(cwd)?.pkg;

  p.intro(`${c.bold("dx")} ${c.gray(`v${version}`)}`);
  p.log.message([
    `${c.gray("project")} ${pkg?.name ?? path.basename(cwd)}`,
    `${c.gray("config ")} ${configFile ? path.relative(cwd, configFile) || configFile : c.yellow("none, using built-in dx defaults")}`,
  ]);

  let last: Action = configFile ? "lint" : "init";

  while (true) {
    const inGit = isGitRepo(cwd);
    const changed = inGit ? gitFiles(cwd, { kind: "changed" }).length : 0;
    const staged = inGit ? gitFiles(cwd, { kind: "staged" }).length : 0;
    const gitHint = (count: number): string => inGit ? plural(count, "file") : "not a git repository";

    const action: Action | typeof p.CANCEL_SYMBOL = await p.select<Action>({
      message: "What do you want to do?",
      initialValue: last,
      options: [
        { value: "lint", label: "Lint project" },
        { value: "fix", label: "Fix project", hint: "apply automatic fixes" },
        { value: "lint-changed", label: "Lint changed files", hint: gitHint(changed), disabled: !inGit },
        { value: "fix-changed", label: "Fix changed files", hint: gitHint(changed), disabled: !inGit },
        { value: "lint-staged", label: "Lint staged files", hint: gitHint(staged), disabled: !inGit },
        { value: "init", label: "Set up ESLint config", hint: findFlatConfig(cwd) ? "replace existing" : "recommended" },
        { value: "doctor", label: "Doctor", hint: "check the project setup" },
        { value: "inspect", label: "Inspect config", hint: "opens in the browser" },
        { value: "exit", label: "Exit" },
      ],
    });

    if (p.isCancel(action) || action === "exit") {
      p.outro("Done");

      return 0;
    }

    last = action;

    switch (action) {
      case "lint":

      case "fix":
        await lintAction(cwd, action === "fix");
        break;

      case "lint-changed":

      case "fix-changed":
        await lintAction(cwd, action === "fix-changed", "changed");
        break;

      case "lint-staged":
        await lintAction(cwd, false, "staged");
        break;

      case "init":
        await initAction(cwd);
        break;

      case "doctor":
        await doctorAction(cwd);
        break;

      case "inspect":
        await inspectAction(cwd);
        break;
    }
  }
}
