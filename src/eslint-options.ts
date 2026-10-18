import { createEslintOptions, decodeParams } from "./lib/eslint-options";



// ESLint loads this module in the main thread and in every worker thread, with the dx lint
// parameters in the URL query, so options that are functions work with concurrency.
const params = new URL(import.meta.url).searchParams.get("p");

// ESLint reads the default export as a plain object, so it has to be awaited here.
// eslint-disable-next-line antfu/no-top-level-await
export default params ? await createEslintOptions(decodeParams(params)) : {};
