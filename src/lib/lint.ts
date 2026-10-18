import type { EslintParams } from "./eslint-options";
import type { GitScope } from "./git";
import path from "node:path";
import process from "node:process";

import { ESLint } from "eslint";
import { DX_CLI_ENV } from "../shared";
import { encodeParams } from "./eslint-options";
import { gitFiles } from "./git";
import { findFlatConfig } from "./project";



export interface LintOptions {
  cwd: string;
  patterns?: string[];
  scope?: GitScope;
  fix?: boolean;
  cache?: boolean;
  quiet?: boolean;
  maxWarnings?: number;
  format?: string;
}

export interface LintReport {
  configFile?: string;
  fileCount: number;
  errorCount: number;
  warningCount: number;
  fixableCount: number;
  fixedFileCount: number;
  output: string;
  durationMs: number;
  tooManyWarnings: boolean;
  ok: boolean;
}

/**
 * @description
 * Runs a task while dropping ESLint's poor concurrency warnings, which would end up in the
 * middle of the dx output. ESLint keeps a reference to process.emitWarning from the moment
 * an instance is created, so the task has to create the instance.
 *
 * @param task - The task.
 * @returns The task result.
 */
async function withoutConcurrencyWarnings<T>(task: () => Promise<T>): Promise<T> {
  const original = Object.getOwnPropertyDescriptor(process, "emitWarning");
  const emitWarning = process.emitWarning.bind(process);

  /**
   * @description
   * Forwards every warning except the poor concurrency one.
   *
   * @param warning - The warning.
   * @param args - The warning type or options.
   */
  process.emitWarning = (warning: string | Error, ...args: unknown[]) => {
    const type = typeof args[0] === "string" ? args[0] : (args[0] as { type?: string } | undefined)?.type;

    if (type !== "ESLintPoorConcurrencyWarning") {
      Reflect.apply(emitWarning, process, [warning, ...args]);
    }
  };

  try {
    return await task();
  }
  finally {
    if (original) {
      Object.defineProperty(process, "emitWarning", original);
    }
  }
}

/**
 * @description
 * Runs ESLint with the project's flat config, falling back to the built-in dx config
 * when the project has none. Large projects are linted with worker threads.
 *
 * @param options - Lint options.
 * @returns The lint report.
 */
export async function lint(options: LintOptions): Promise<LintReport> {
  const start = performance.now();
  const cwd = path.resolve(options.cwd);
  const configFile = findFlatConfig(cwd);
  const fromGit = options.scope !== undefined;
  const patterns = fromGit ? gitFiles(cwd, options.scope!) : (options.patterns?.length ? options.patterns : ["."]);

  process.env[DX_CLI_ENV] = "1";

  if (patterns.length === 0) {
    return {
      configFile,
      fileCount: 0,
      errorCount: 0,
      warningCount: 0,
      fixableCount: 0,
      fixedFileCount: 0,
      output: "",
      durationMs: performance.now() - start,
      tooManyWarnings: false,
      ok: true,
    };
  }

  const params: EslintParams = {
    cwd,
    fix: options.fix ?? false,
    cache: options.cache ?? false,
    cacheLocation: path.join(cwd, "node_modules", ".cache", "dx", "eslintcache"),
    quiet: options.quiet ?? false,
    fromGit,
    builtIn: !configFile,
    concurrency: "auto",
  };

  // Worker threads load the options from this module, so options that are functions work too.
  const url = new URL("./eslint-options.mjs", import.meta.url);

  url.searchParams.set("p", encodeParams(params));

  const { eslint, results } = await withoutConcurrencyWarnings(async () => {
    const instance = await ESLint.fromOptionsModule(url);

    return { eslint: instance, results: await instance.lintFiles(patterns) };
  });

  if (options.fix) {
    await ESLint.outputFixes(results);
  }

  const visible = options.quiet ? ESLint.getErrorResults(results) : results;
  const formatter = await eslint.loadFormatter(options.format ?? "stylish");
  const output = await formatter.format(visible);

  const sum = (pick: (result: ESLint.LintResult) => number): number => results.reduce((total, result) => total + pick(result), 0);
  const errorCount = sum(result => result.errorCount);
  const warningCount = options.quiet ? 0 : sum(result => result.warningCount);
  const maxWarnings = options.maxWarnings ?? -1;
  const tooManyWarnings = maxWarnings >= 0 && warningCount > maxWarnings;

  return {
    configFile,
    fileCount: results.length,
    errorCount,
    warningCount,
    fixableCount: sum(result => result.fixableErrorCount + (options.quiet ? 0 : result.fixableWarningCount)),
    fixedFileCount: results.filter(result => result.output !== undefined).length,
    output: typeof output === "string" ? output.trim() : "",
    durationMs: performance.now() - start,
    tooManyWarnings,
    ok: errorCount === 0 && !tooManyWarnings,
  };
}
