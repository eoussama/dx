#!/usr/bin/env node
import { argv, exit } from "node:process";
import { ESLint } from "eslint";



async function main() {
  const [cmd, ...rest] = argv.slice(2);

  try {
    if (cmd === "lint") {
      const eslint = new ESLint({ overrideConfigFile: "eslint.config.js" });
      const results = await eslint.lintFiles(["."]);

      if (rest.includes("--fix"))
        await ESLint.outputFixes(results);

      const fmt = await eslint.loadFormatter("stylish");
      console.log(fmt.format(results));

      const errorCount = results.reduce((s, r) => s + r.errorCount, 0);
      if (errorCount)
        exit(1);
    }
    else {
      console.log("Usage: dx <lint [--fix]>");
    }
  }
  catch (err) {
    console.error(err);
    exit(1);
  }
}

main();
