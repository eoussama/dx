#!/usr/bin/env node

import process from "node:process";

import { run } from "./lib/main";



run(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
