import { cookies } from "next/headers";
import { getEnv } from "@/lib/cloudflare";
import { DEFAULT_LOCALE, LOCALE_COOKIE, createTranslator, loadMessages, resolveLocale } from "./utils";
import { loadCatalog } from "./catalog-store";
import type { Locale, Messages } from "./types";

/** The locale chosen in the preference cookie, for server code that must render in it. */
export async function getRequestLocale() {
	return resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value);
}

// Catalogs only change with a deploy, which starts new isolates; the dev server re-reads them so edits show.
const reloadCatalogs = typeof process !== "undefined" && process.env.NODE_ENV === "development";

/**
 * Server-side catalog load through the static assets binding, read and parsed once per isolate rather than
 * on every render; English when the catalog cannot be read. It also makes the catalog available to the HTML
 * render of `LanguageProvider` (see `catalog-store.ts`).
 */
export async function loadServerMessages(locale: Locale): Promise<Partial<Messages> | undefined> {
	try {
		if (locale === DEFAULT_LOCALE) return await loadMessages(locale);
		return await loadCatalog(locale, () => {
			const assets = getEnv().ASSETS;
			return loadMessages(locale, (path) => assets.fetch(new URL(path, "https://mailclaw.local")));
		}, { reload: reloadCatalogs });
	} catch (error) {
		console.warn(`Falling back to English: ${error instanceof Error ? error.message : error}`);
		return undefined;
	}
}

// For server components and route handlers; client components use `useLanguage()`.
export async function getServerTranslator() {
	const locale = await getRequestLocale();
	return createTranslator(locale, await loadServerMessages(locale));
}
