import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { defineConfig } from "tsdown";



const shared = {
  platform: "node",
  target: "node20.19",
  outDir: "dist",
} as const;

/**
 * @description
 * Rewrites the CommonJS declarations to match `module.exports = dx`:
 * the default export becomes `export =`, the named types move into a namespace
 * merged with the function, and the ESM-only imports get an import resolution mode.
 *
 * @param file - Path to the .d.cts file.
 */
function fixCjsDeclarations(file: string): void {
  if (!existsSync(file)) {
    return;
  }

  const source = readFileSync(file, "utf8");
  const types = [...source.matchAll(/^export type (\w+) =/gm)].map(match => match[1]!);
  const name = /^export default function (\w+)\(/m.exec(source)?.[1];

  if (!name) {
    return;
  }

  const fixed = types
    .reduce((text, type) => text.replace(new RegExp(`\\b${type}\\b`, "g"), `_${type}`), source)
    .replace(/^import \{ (.+) \} from "([^"]+)";$/gm, "import type { $1 } from \"$2\" with { \"resolution-mode\": \"import\" };")
    .replace(/^export type (\w+) =/gm, "type $1 =")
    .replace(/^export default function /m, "declare function ");

  const namespace = types.map(type => `  export type ${type} = _${type};`).join("\n");

  writeFileSync(file, `${fixed.trimEnd()}\n\ndeclare namespace ${name} {\n${namespace}\n}\n\nexport = ${name};\n`, "utf8");
}

export default defineConfig([
  {
    ...shared,
    entry: { index: "src/index.ts" },
    format: ["esm", "cjs"],
    clean: true,
    dts: {
      // Declarations are emitted by the TypeScript 7 native compiler.
      generator: "tsgo",
      tsgo: { path: "node_modules/@typescript/native/bin/tsc" },
    },
    hooks: {
      "build:done": () => fixCjsDeclarations("dist/index.d.cts"),
    },
  },
  {
    ...shared,
    entry: { cli: "src/cli.ts" },
    format: "esm",
    clean: false,
    dts: false,
  },
]);
