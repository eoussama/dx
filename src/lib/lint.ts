import type { Linter } from "eslint";
import type { GitScope } from "./git";
import path from "node:path";
import process from "node:process";

import { ESLint } from "eslint";
import dx from "../index";
import { DX_CLI_ENV } from "../shared";
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
 * Runs ESLint with the project's flat config, falling back to the built-in dx config
 * when the project has none.
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

  const eslint = new ESLint({
    cwd,
    fix: options.fix ?? false,
    cache: options.cache ?? false,
    cacheLocation: path.join(cwd, "node_modules", ".cache", "dx", "eslintcache"),
    cacheStrategy: "content",
    errorOnUnmatchedPattern: !fromGit,
    warnIgnored: !fromGit,
    ...(options.quiet ? { ruleFilter: ({ severity }: { severity: number }) => severity === 2 } : {}),
    ...(configFile ? {} : { overrideConfigFile: true, overrideConfig: await dx() as Linter.Config[] }),
  });

  const results = await eslint.lintFiles(patterns);

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
