import { cookies } from "next/headers";
import { getEnv } from "@/lib/cloudflare";
// Server-only: the browser fetches this same file as `/locales/en.json` (client code must not import it, or
// the whole catalog lands in every page's JavaScript).
import en from "../../../public/locales/en.json";
import { DEFAULT_LOCALE, LOCALE_COOKIE, createTranslator, loadMessages, resolveLocale } from "./utils";
import { loadCatalog, rememberCatalog } from "./catalog-store";
import type { Locale, Messages } from "./types";

const english: Messages = en;

/** The locale chosen in the preference cookie, for server code that must render in it. */
export async function getRequestLocale() {
	return resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value);
}

// Catalogs only change with a deploy, which starts new isolates; the dev server re-reads them so edits show.
const reloadCatalogs = typeof process !== "undefined" && process.env.NODE_ENV === "development";

/**
 * Server-side catalog load, and what makes the catalog available to the HTML render of `LanguageProvider`
 * (see `catalog-store.ts`). English is bundled with the server; other catalogs are read through the static
 * assets binding once per isolate rather than on every render, and are undefined when they cannot be read.
 */
export async function loadServerMessages(locale: Locale): Promise<Partial<Messages> | undefined> {
	if (locale === DEFAULT_LOCALE) {
		rememberCatalog(DEFAULT_LOCALE, english);
		return english;
	}
	try {
		return await loadCatalog(locale, () => {
			const assets = getEnv().ASSETS;
			return loadMessages(locale, (path) => assets.fetch(new URL(path, "https://mailclaw.local")));
		}, { reload: reloadCatalogs });
	} catch (error) {
		console.warn(`Falling back to English: ${error instanceof Error ? error.message : error}`);
		return undefined;
	}
}

// For server components and route handlers; client components use `useLanguage()`. English fills any key the
// catalog lacks, and the whole catalog when it cannot be read.
export async function getServerTranslator() {
	const locale = await getRequestLocale();
	return createTranslator(locale, (await loadServerMessages(locale)) ?? english, english);
}
