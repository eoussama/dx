import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import process from "node:process";
import { fileURLToPath } from "node:url";



// Preloaded with --import by the unit tests and the mutation tests.

// The sources detect colors once, when they load, and the tests compare plain output.
process.env.NO_COLOR = "1";
delete process.env.FORCE_COLOR;

// Lets the tests import the TypeScript sources directly, the way tsdown bundles them:
// extensionless relative imports resolve to .ts files, JSON files imported by the sources
// expose their top level keys as named exports, and the options module that dx loads by URL
// maps to its source. Node strips the types on its own. ESLint's worker threads inherit this
// hook through --import.

const SOURCE = new URL("../src/", import.meta.url).href;
const OPTIONS_MODULE = new URL("lib/eslint-options.mjs", SOURCE).href;
const NAMED_JSON = "dx-named-json";
const IDENTIFIER = /^[$A-Z_][\w$]*$/i;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(OPTIONS_MODULE)) {
      return { url: specifier.replace(OPTIONS_MODULE, new URL("eslint-options.ts", SOURCE).href), shortCircuit: true };
    }

    const parent = context.parentURL ?? "";

    if (!specifier.startsWith(".") || !parent.startsWith(SOURCE)) {
      return nextResolve(specifier, context);
    }

    const url = new URL(specifier, parent);

    if (url.pathname.endsWith(".json")) {
      url.searchParams.set(NAMED_JSON, "");

      return { url: url.href, format: "module", shortCircuit: true };
    }

    if (!/\.\w+$/.test(url.pathname) && existsSync(fileURLToPath(`${url.href}.ts`))) {
      return { url: `${url.href}.ts`, format: "module-typescript", shortCircuit: true };
    }

    return nextResolve(specifier, context);
  },

  load(url, context, nextLoad) {
    const parsed = new URL(url);

    if (!parsed.searchParams.has(NAMED_JSON)) {
      return nextLoad(url, context);
    }

    const data = JSON.parse(readFileSync(fileURLToPath(new URL(parsed.pathname, parsed)), "utf8"));
    const named = Object.keys(data)
      .filter(key => IDENTIFIER.test(key))
      .map(key => `export const ${key} = data[${JSON.stringify(key)}];`);

    return {
      format: "module",
      source: `const data = ${JSON.stringify(data)};\nexport default data;\n${named.join("\n")}\n`,
      shortCircuit: true,
    };
  },
});
