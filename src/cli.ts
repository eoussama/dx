#!/usr/bin/env node

import path from "node:path";
import process from "node:process";

import { Command } from "commander";
import { ESLint } from "eslint";



const program = new Command();

async function runESLint({ fix }: { fix: boolean }): Promise<void> {
  const eslint = new ESLint({
    overrideConfigFile: path.resolve("eslint.config.js"),
    fix,
  });

  const results = await eslint.lintFiles(["."]);

  if (fix) {
    await ESLint.outputFixes(results);
  }

  const formatter = await eslint.loadFormatter("stylish");

  // eslint-disable-next-line no-console
  console.log(formatter.format(results));

  const errorCount = results.reduce((sum, r) => sum + r.errorCount, 0);

  if (errorCount > 0) {
    process.exitCode = 1;
  }
}

program
  .name("dx")
  .description("Developer experience helper CLI")
  .version("1.0.0");

program
  .command("lint")
  .description("Run ESLint on the project")
  .option("--fix", "Automatically fix problems", false)
  .action(async (opts) => {
    try {
      await runESLint({ fix: opts.fix });
    }
    catch (err) {
      console.error(err);
      process.exit(1);
    }
  });

program.parse(process.argv);
