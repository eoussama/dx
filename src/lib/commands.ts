import type { Check } from "./doctor";
import type { GitScope } from "./git";
import type { InitStep } from "./init";
import type { LintOptions, LintReport } from "./lint";

import { describeScope, isGitRepo } from "./git";
import { c, duration, errorMessage, log, plural, print } from "./term";



export interface Summary {
  level: "success" | "warn" | "error";
  message: string;
  hints: string[];
}

/**
 * @description
 * Builds the human summary of a lint run.
 *
 * @param report - The lint report.
 * @param options - The options the lint ran with.
 * @returns The summary.
 */
export function summarizeLint(report: LintReport, options: LintOptions): Summary {
  const time = c.gray(`(${duration(report.durationMs)})`);
  const hints: string[] = [];

  if (!report.configFile) {
    hints.push("No ESLint config found, used the built-in dx defaults. Run `dx init` to add one.");
  }

  if (report.fileCount === 0) {
    return { level: "success", message: `No ${options.scope ? describeScope(options.scope) : "files"} to lint ${time}`, hints };
  }

  const fixed = options.fix && report.fixedFileCount
    ? `, fixed ${plural(report.fixedFileCount, "file")}`
    : "";

  if (report.errorCount === 0 && report.warningCount === 0) {
    return { level: "success", message: `No problems in ${plural(report.fileCount, "file")}${fixed} ${time}`, hints };
  }

  const counts = [
    report.errorCount ? c.red(plural(report.errorCount, "error")) : "",
    report.warningCount ? c.yellow(plural(report.warningCount, "warning")) : "",
  ].filter(Boolean).join(", ");

  // The stylish formatter already prints its own fixable summary.
  if (!options.fix && report.fixableCount && options.format !== undefined && options.format !== "stylish") {
    hints.push(`${plural(report.fixableCount, "problem")} can be fixed with \`dx fix\`.`);
  }

  if (report.tooManyWarnings) {
    hints.push(`Too many warnings, the limit is ${options.maxWarnings}.`);
  }

  return {
    level: report.ok ? "warn" : "error",
    message: `${counts} in ${plural(report.fileCount, "file")}${fixed} ${time}`,
    hints,
  };
}

/**
 * @description
 * Runs ESLint and prints the formatter output and summary.
 *
 * @param options - Lint options.
 * @returns The process exit code.
 */
export async function runLint(options: LintOptions): Promise<number> {
  if (options.scope && !isGitRepo(options.cwd)) {
    log.error(`Cannot lint ${describeScope(options.scope)} outside of a git repository.`);

    return 2;
  }

  try {
    const { lint } = await import("./lint");
    const report = await lint(options);
    const summary = summarizeLint(report, options);

    if (report.output) {
      print(report.output);
      print();
    }

    const logSummary = {
      success: log.success,
      warn: log.warn,
      error: log.fail,
    };

    logSummary[summary.level](summary.message);
    summary.hints.forEach(log.hint);

    return report.ok ? 0 : 1;
  }
  catch (error) {
    log.error(errorMessage(error));

    return 2;
  }
}

/**
 * @description
 * Describes an init step for humans.
 *
 * @param step - The init step.
 * @returns The description.
 */
export function describeInitStep(step: InitStep): string {
  switch (step.kind) {
    case "written":
      return `Wrote ${c.cyan(step.file)}`;

    case "backup":
      return `Moved ${step.from} to ${c.cyan(step.to)}`;

    default:
      return `Skipped ${step.file}: ${step.reason}`;
  }
}

/**
 * @description
 * Formats a doctor check as a line.
 *
 * @param check - The check.
 * @returns The formatted line.
 */
export function formatCheck(check: Check): string {
  const marks = {
    ok: c.green("ok   "),
    info: c.blue("info "),
    warn: c.yellow("warn "),
    error: c.red("error"),
  };

  return `${marks[check.status]} ${c.bold(check.label.padEnd(16))} ${check.detail}`;
}

/**
 * @description
 * Computes the doctor exit code from its checks.
 *
 * @param checks - The doctor checks.
 * @returns 1 when any check failed, 0 otherwise.
 */
export function doctorExitCode(checks: Check[]): number {
  return checks.some(check => check.status === "error") ? 1 : 0;
}

/**
 * @description
 * Resolves the git scope from the lint flags.
 *
 * @param flags - Parsed flags.
 * @param flags.changed - Lint changed and untracked files.
 * @param flags.staged - Lint staged files.
 * @param flags.since - Lint files changed since a git ref.
 * @returns The git scope, or undefined to lint the whole project.
 */
export function resolveScope(flags: { changed?: boolean; staged?: boolean; since?: string }): GitScope | undefined {
  const selected = [flags.changed, flags.staged, flags.since !== undefined].filter(Boolean).length;

  if (selected > 1) {
    throw new Error("--changed, --staged and --since cannot be combined.");
  }

  if (flags.since !== undefined) {
    return { kind: "since", ref: flags.since };
  }

  if (flags.staged) {
    return { kind: "staged" };
  }

  return flags.changed ? { kind: "changed" } : undefined;
}
