/** @type {import("@stryker-mutator/api/core").PartialStrykerOptions} */
export default {
  // The unit tests import the TypeScript sources through test/register.mjs, so the mutants
  // run without a build. The CLI smoke tests run the built dist/ and are left out.
  testRunner: "tap",
  // pnpm does not hoist the plugins next to @stryker-mutator/core, so they are named explicitly.
  plugins: ["@stryker-mutator/tap-runner", "@stryker-mutator/typescript-checker"],
  tap: {
    testFiles: ["test/unit/*.test.mjs"],
    nodeArgs: [
      "--import",
      "./test/register.mjs",
      "--experimental-test-module-mocks",
      "--test-reporter=tap",
      "-r",
      "{{hookFile}}",
      "{{testFile}}",
    ],
    forceBail: true,
  },
  // Mutants that do not type check, like an empty string where an encoding is expected,
  // are rejected before any test runs.
  checkers: ["typescript"],
  tsconfigFile: "tsconfig.json",
  mutate: [
    "src/**/*.ts",
    // The bin entry only forwards to src/lib/main.ts.
    "!src/cli.ts",
  ],
  ignorePatterns: ["dist", "reports"],
  coverageAnalysis: "perTest",
  incremental: true,
  incrementalFile: "reports/stryker-incremental.json",
  reporters: ["html", "clear-text", "progress"],
  htmlReporter: { fileName: "reports/mutation/index.html" },
  thresholds: { high: 90, low: 80, break: 80 },
  // Tests that lint start ESLint and its worker threads, so running too many at once starves
  // the CPU and turns slow runs into false timeouts.
  concurrency: 6,
  timeoutMS: 20000,
};
