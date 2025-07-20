import { defineBuildConfig } from "unbuild";



export default defineBuildConfig({
  entries: [
    "./src/cli",
    "./src/index",
  ],
  rollup: {
    emitCJS: true,
  },
  clean: true,
  outDir: "dist",
  declaration: true,
});
