#!/usr/bin/env node

import { spawn } from "node:child_process";
import process from "node:process";

import { Command } from "commander";
import packageJson from "../package.json";



const program = new Command();

async function runESLint({ fix }: { fix: boolean }): Promise<void> {
  try {
    const args = ["eslint", "."];

    if (fix) {
      args.push("--fix");
    }

    // eslint-disable-next-line no-console
    console.log(`🔍 Running ESLint${fix ? " with --fix" : ""}...`);

    const eslintProcess = spawn("npx", args, {
      stdio: "inherit",
      cwd: process.cwd(),
    });

    eslintProcess.on("close", (code) => {
      if (code === 0) {
        if (fix) {
          // eslint-disable-next-line no-console
          console.log("✅ ESLint completed successfully with fixes applied.");
        }
        else {
          // eslint-disable-next-line no-console
          console.log("✅ ESLint completed successfully - no issues found.");
        }
      }
      else if (code === 1) {
        // eslint-disable-next-line no-console
        console.log(`\n❌ ESLint found linting issues.${fix ? " Some may have been auto-fixed." : " Run with --fix to auto-fix issues."}`);
        process.exit(1);
      }
      else if (code === 2) {
        console.error("❌ ESLint encountered a fatal error.");
        process.exit(2);
      }
      else {
        console.error(`❌ ESLint exited with unexpected code: ${code}`);
        process.exit(code || 1);
      }
    });

    eslintProcess.on("error", (error) => {
      if (error.message.includes("ENOENT")) {
        console.error("❌ Error: npx or ESLint not found.");
        console.error("💡 Make sure you have Node.js and npm/pnpm installed, and ESLint is available.");
        console.error("   Try running: npm install eslint");
      }
      else {
        console.error("❌ Error running ESLint:", error.message);
      }
      process.exit(1);
    });
  }
  catch (error) {
    if (error instanceof Error) {
      console.error("❌ Error:", error.message);
    }
    else {
      console.error("❌ Unknown error:", error);
    }
    process.exit(1);
  }
}

program
  .name("dx")
  .description("Developer experience helper CLI")
  .version(packageJson.version);

program
  .command("lint")
  .description("Run ESLint on the project")
  .option("--fix", "Automatically fix problems", false)
  .action(async (opts) => {
    await runESLint({ fix: opts.fix });
  });

if (process.argv.length <= 2) {
  program.help();
}

program.parse(process.argv);
