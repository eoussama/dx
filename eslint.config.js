import dx from "@eoussama/dx";



export default dx({}, {
  files: ["test/**"],
  rules: {
    // The smoke tests use node:test on purpose, they do not depend on vitest.
    "test/no-import-node-test": "off",
  },
});
