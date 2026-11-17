"use client";

import { createContext, use, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { DEFAULT_LOCALE, createTranslator, getDirection, loadMessages, resolveLocale, serializeLocaleCookie } from "@/lib/i18n/utils";
import { loadCatalog, peekCatalog } from "@/lib/i18n/catalog-store";
import type { Locale, Messages } from "@/lib/i18n/types";
import type { LanguageState } from "./language-provider-types";

const LanguageContext = createContext<LanguageState>({
	locale: DEFAULT_LOCALE,
	setLocale: () => undefined,
	t: createTranslator(DEFAULT_LOCALE),
});

type Active = { locale: Locale; messages?: Partial<Messages> };

// When the catalog cannot be fetched (offline) the page renders English rather than failing; choosing the
// language again in the selector retries.
const UNAVAILABLE_CATALOG: Partial<Messages> = {};

/** Browser load of a catalog from `public/locales`, cached for the tab; `UNAVAILABLE_CATALOG` when it fails. */
function loadClientCatalog(locale: Locale, retryFailed = false): Promise<Partial<Messages>> {
	return locale === DEFAULT_LOCALE
		? loadMessages(locale)
		: loadCatalog(locale, () => loadMessages(locale), { fallback: UNAVAILABLE_CATALOG, retryFailed });
}

/**
 * The catalog to render with. English is bundled. Another language's catalog is not part of the page:
 * while the server renders the HTML it is already in the catalog store (the root layout loaded it), and
 * in the browser it comes from `/locales/<code>.json`, which the root layout preloads. Hydration waits
 * for that file (`use`), keeping the translated server HTML on screen, so there is no flash of English.
 */
function useCatalog(locale: Locale, explicit: Partial<Messages> | undefined): Partial<Messages> | undefined {
	if (explicit || locale === DEFAULT_LOCALE) return explicit;
	// On the server a missing catalog means it could not be read; the layout then renders English.
	if (typeof window === "undefined") return peekCatalog(locale);
	// A loaded catalog's promise is marked fulfilled, so `use` returns it without suspending.
	return use(loadClientCatalog(locale));
}

/**
 * `initialMessages` overrides the catalog for `initialLocale` (tests, or `{}` to render English when the
 * server could not read the catalog). Without it the catalog comes from the catalog store (`useCatalog`).
 */
export function LanguageProvider({ initialLocale, initialMessages, children }: { initialLocale: Locale; initialMessages?: Partial<Messages>; children: ReactNode }) {
	const [active, setActive] = useState<Active>({ locale: initialLocale, messages: initialMessages });
	const latestRequest = useRef(0);
	const messages = useCatalog(active.locale, active.messages);

	const setLocale = useCallback((next: Locale) => {
		const nextLocale = resolveLocale(next);
		const request = ++latestRequest.current;
		void loadClientCatalog(nextLocale, true).then((nextMessages) => {
			// An unreachable catalog leaves the current language in place, as a failed load always has.
			if (request !== latestRequest.current || nextMessages === UNAVAILABLE_CATALOG) return;
			// Preference cookies can be disabled; the selection still works for this session.
			try {
				document.cookie = serializeLocaleCookie(nextLocale, window.location.protocol === "https:");
			} catch {
				// Keep the in-memory preference when cookie storage is unavailable.
			}
			document.documentElement.lang = nextLocale;
			document.documentElement.dir = getDirection(nextLocale);
			setActive({ locale: nextLocale, messages: nextMessages });
		}).catch(() => undefined);
	}, []);

	const value = useMemo<LanguageState>(
		() => ({ locale: active.locale, setLocale, t: createTranslator(active.locale, messages) }),
		[active.locale, messages, setLocale],
	);

	return (
		<LanguageContext.Provider value={value}>
			{children}
		</LanguageContext.Provider>
	);
}

export function useLanguage() {
	return useContext(LanguageContext);
}
