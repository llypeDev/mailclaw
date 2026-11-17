import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { transform } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The English catalog, the static asset the browser fetches as `/locales/en.json`. */
export const englishCatalog = JSON.parse(readFileSync(join(root, "public", "locales", "en.json"), "utf8"));

/**
 * Puts English in the catalog store, as the root layout does on the server and the browser does when it
 * fetches `/locales/en.json`, so components rendered without the layout show English rather than keys.
 * The store lives on `globalThis`, so the copy of `catalog-store.ts` loaded here is the one every bundle sees.
 */
export async function registerEnglishCatalog() {
	const { code } = await transform(readFileSync(join(root, "src", "lib", "i18n", "catalog-store.ts"), "utf8"), { loader: "ts", format: "esm" });
	const { rememberCatalog } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
	rememberCatalog("en", englishCatalog);
}
