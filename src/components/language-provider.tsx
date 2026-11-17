"use client";

import { createContext, use, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { DEFAULT_LOCALE, createTranslator, defaultTranslator, getDirection, loadMessages, resolveLocale, serializeLocaleCookie } from "@/lib/i18n/utils";
import { loadCatalog, peekCatalog } from "@/lib/i18n/catalog-store";
import type { Locale, Messages } from "@/lib/i18n/types";
import type { LanguageState } from "./language-provider-types";

const LanguageContext = createContext<LanguageState>({
	locale: DEFAULT_LOCALE,
	setLocale: () => undefined,
	t: defaultTranslator,
});

/** `catalog` is whose messages render the page: `locale`'s own, or English when that one could not be read. */
type Active = { locale: Locale; catalog: Locale; messages?: Partial<Messages> };

// When a catalog cannot be fetched (offline) the page renders English rather than failing, if English can
// be fetched; choosing the language again in the selector retries.
const UNAVAILABLE_CATALOG: Partial<Messages> = {};

/** Browser load of a catalog from `public/locales`, cached for the tab; `UNAVAILABLE_CATALOG` when it fails. */
function loadClientCatalog(locale: Locale, retryFailed = false): Promise<Partial<Messages>> {
	return loadCatalog(locale, () => loadMessages(locale), { fallback: UNAVAILABLE_CATALOG, retryFailed });
}

/**
 * The catalog to render with. No catalog is part of the page, English included: while the server renders
 * the HTML it is already in the catalog store (the root layout loaded it), and in the browser it comes from
 * `/locales/<code>.json`, which the root layout preloads. Hydration waits for that file (`use`), keeping the
 * server HTML on screen, so there is no flash of untranslated text.
 */
function useCatalog(locale: Locale, explicit: Partial<Messages> | undefined): Partial<Messages> {
	if (explicit) return explicit;
	// The layout loaded `locale`'s catalog on the server before rendering this.
	if (typeof window === "undefined") return peekCatalog(locale) ?? peekCatalog(DEFAULT_LOCALE) ?? UNAVAILABLE_CATALOG;
	// A loaded catalog's promise is marked fulfilled, so `use` returns it without suspending.
	const messages = use(loadClientCatalog(locale));
	return messages === UNAVAILABLE_CATALOG && locale !== DEFAULT_LOCALE ? use(loadClientCatalog(DEFAULT_LOCALE)) : messages;
}

/**
 * `catalogLocale` renders `initialLocale` with another language's catalog: the root layout passes English
 * when the server could not read `initialLocale`'s, so both sides render the same text. `initialMessages`
 * overrides the catalog (tests). Otherwise the catalog comes from the catalog store (`useCatalog`).
 */
export function LanguageProvider({ initialLocale, catalogLocale, initialMessages, children }: { initialLocale: Locale; catalogLocale?: Locale; initialMessages?: Partial<Messages>; children: ReactNode }) {
	const [active, setActive] = useState<Active>({ locale: initialLocale, catalog: catalogLocale ?? initialLocale, messages: initialMessages });
	const latestRequest = useRef(0);
	const messages = useCatalog(active.catalog, active.messages);

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
			setActive({ locale: nextLocale, catalog: nextLocale, messages: nextMessages });
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
