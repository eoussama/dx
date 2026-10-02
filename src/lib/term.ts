import process from "node:process";



type Paint = (text: string | number) => string;

const env = process.env;

const colorEnabled = !("NO_COLOR" in env)
  && ("FORCE_COLOR" in env || (process.stdout.isTTY === true && env.TERM !== "dumb"));

/**
 * @description
 * Builds an ANSI color function that is a no-op when colors are disabled.
 *
 * @param open - Opening SGR code.
 * @param close - Closing SGR code.
 * @returns The paint function.
 */
function paint(open: number, close: number): Paint {
  return text => colorEnabled ? `\u001B[${open}m${text}\u001B[${close}m` : String(text);
}

export const c = {
  bold: paint(1, 22),
  dim: paint(2, 22),
  red: paint(31, 39),
  green: paint(32, 39),
  yellow: paint(33, 39),
  blue: paint(34, 39),
  cyan: paint(36, 39),
  gray: paint(90, 39),
};

/**
 * @description
 * Writes a line to stdout.
 *
 * @param message - Line to print.
 */
export function print(message = ""): void {
  process.stdout.write(`${message}\n`);
}

/**
 * @description
 * Writes a line to stderr.
 *
 * @param message - Line to print.
 */
export function printError(message = ""): void {
  process.stderr.write(`${message}\n`);
}

/** Status messages go to stderr so stdout stays clean for formatter output. */
export const log = {
  info: (message: string): void => printError(`${c.blue("info")}  ${message}`),
  success: (message: string): void => printError(`${c.green("done")}  ${message}`),
  warn: (message: string): void => printError(`${c.yellow("warn")}  ${message}`),
  error: (message: string): void => printError(`${c.red("error")} ${message}`),
  fail: (message: string): void => printError(`${c.red("fail")}  ${message}`),
  hint: (message: string): void => printError(`${c.gray("hint")}  ${c.gray(message)}`),
};

/**
 * @description
 * Pluralizes a word based on a count.
 *
 * @param count - Number of items.
 * @param word - Singular form of the word.
 * @returns The count followed by the word in the right form.
 */
export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/**
 * @description
 * Formats a duration in milliseconds for humans.
 *
 * @param ms - Duration in milliseconds.
 * @returns The formatted duration.
 */
export function duration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(2)}s`;
}

/**
 * @description
 * Extracts a printable message from an unknown thrown value.
 *
 * @param error - The thrown value.
 * @returns The error message.
 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
