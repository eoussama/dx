import type { ESLint } from "eslint";
import { Buffer } from "node:buffer";



/** Serializable inputs of the ESLint options, so worker threads can rebuild them. */
export interface EslintParams {
  cwd: string;
  fix: boolean;
  cache: boolean;
  cacheLocation: string;
  quiet: boolean;
  fromGit: boolean;
  /** Use the built-in dx config instead of a config file. */
  builtIn: boolean;
  concurrency: "auto" | "off";
}

/**
 * @description
 * Builds the ESLint options for a lint run.
 *
 * @param params - The serializable parameters.
 * @returns The ESLint options.
 */
export async function createEslintOptions(params: EslintParams): Promise<ESLint.Options> {
  const builtIn = params.builtIn ? await (await import("../index")).default() : undefined;

  return {
    cwd: params.cwd,
    fix: params.fix,
    cache: params.cache,
    cacheLocation: params.cacheLocation,
    cacheStrategy: "content",
    concurrency: params.concurrency,
    errorOnUnmatchedPattern: !params.fromGit,
    warnIgnored: !params.fromGit,
    ...(params.quiet ? { ruleFilter: ({ severity }: { severity: number }) => severity === 2 } : {}),
    ...(builtIn ? { overrideConfigFile: true, overrideConfig: builtIn } : {}),
  };
}

/**
 * @description
 * Encodes the parameters for the options module URL.
 *
 * @param params - The parameters.
 * @returns The encoded parameters.
 */
export function encodeParams(params: EslintParams): string {
  return Buffer.from(JSON.stringify(params), "utf8").toString("base64url");
}

/**
 * @description
 * Decodes the parameters from the options module URL.
 *
 * @param encoded - The encoded parameters.
 * @returns The parameters.
 */
export function decodeParams(encoded: string): EslintParams {
  return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as EslintParams;
}
