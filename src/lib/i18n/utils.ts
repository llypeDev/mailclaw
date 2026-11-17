import { peekCatalog } from "./catalog-store";
import { DEFAULT_LOCALE, locales } from "./locales";
import type { Locale, Messages, PluralKey, TranslationKey } from "./types";

// Nothing here imports a catalog, English included: this module is part of every page's JavaScript, and the
// browser fetches each catalog (English too) as the static `/locales/<code>.json`. Server code gets English
// from `server.ts`.

export { DEFAULT_LOCALE } from "./locales";
export const LOCALE_COOKIE = "mailclaw-locale";
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function resolveLocale(value: unknown): Locale {
	return typeof value === "string" && Object.hasOwn(locales, value) ? value as Locale : DEFAULT_LOCALE;
}

export function getDirection(locale: Locale): "ltr" | "rtl" {
	return (locales[locale] as { dir?: "rtl" }).dir ?? "ltr";
}

/** Reads a static asset by path. The browser uses `fetch`; server code passes the `ASSETS` binding. */
export type AssetReader = (path: string) => Promise<Response>;

/** Where a catalog is served from (a static asset in `public/locales`). */
export function catalogPath(locale: Locale): string {
	return `/locales/${locale}.json`;
}

/** Fetches the catalog for a locale, English included, from `public/locales`. */
export async function loadMessages(locale: Locale, read: AssetReader = (path) => fetch(path)): Promise<Partial<Messages>> {
	const response = await read(catalogPath(locale));
	if (!response.ok) throw new Error(`Catalog for ${locale} is unavailable (${response.status})`);
	return response.json();
}

export type TranslationVars = Record<string, string | number | null | undefined>;
export type Translator = (key: TranslationKey | PluralKey, vars?: TranslationVars) => string;

function interpolate(template: string, vars?: TranslationVars): string {
	if (!vars) return template;
	return template.replace(/\{(\w+)\}/g, (match, name: string) => (Object.hasOwn(vars, name) ? String(vars[name] ?? "") : match));
}

/**
 * The message for `key` in `messages`, else in `fallback` (server code passes English), else the key itself.
 * Every registered catalog carries every English key (tests/i18n.test.mjs), so the browser needs no fallback.
 */
export function translate(messages: Partial<Messages>, key: TranslationKey, vars?: TranslationVars, fallback?: Partial<Messages>): string {
	return interpolate(messages[key] ?? fallback?.[key] ?? key, vars);
}

// Server-safe translator. A numeric `count` var selects a plural variant: with
// `inbox.unread.one` / `inbox.unread.other` catalog entries, `t("inbox.unread", { count })`
// uses the locale's CLDR category and falls back to the bare key when no variant exists.
export function createTranslator(locale: Locale, messages: Partial<Messages>, fallback?: Partial<Messages>): Translator {
	const rules = new Intl.PluralRules(locale);
	const known = (key: string) => key in messages || (fallback !== undefined && key in fallback);
	return (key, vars) => {
		const count = vars?.count;
		if (typeof count === "number") {
			for (const category of [rules.select(count), "other"]) {
				const variant = `${key}.${category}`;
				if (known(variant)) return translate(messages, variant as TranslationKey, vars, fallback);
			}
		}
		return translate(messages, key as TranslationKey, vars, fallback);
	};
}

export function serializeLocaleCookie(locale: Locale, secure: boolean): string {
	return `${LOCALE_COOKIE}=${resolveLocale(locale)}; Path=/; Max-Age=${LOCALE_COOKIE_MAX_AGE}; SameSite=Lax${secure ? "; Secure" : ""}`;
}

/** The page's language: `<html lang>`, which the root layout renders and `LanguageProvider` keeps current. */
function pageLocale(): Locale {
	return typeof document === "undefined" ? DEFAULT_LOCALE : resolveLocale(document.documentElement.lang);
}

/**
 * For code with no `t` at hand (a fetch helper's fallback error, a pure helper's default argument). It
 * translates with the catalog already loaded for the page's language, else with English once that has
 * loaded (server code that read it, a test that registered it), else returns the key. It looks the catalog
 * up in the catalog store when called, so it never brings one into the page's JavaScript.
 */
export const defaultTranslator: Translator = (key, vars) => {
	for (const locale of new Set<Locale>([pageLocale(), DEFAULT_LOCALE])) {
		const messages = peekCatalog(locale);
		if (messages && Object.keys(messages).length > 0) return createTranslator(locale, messages)(key, vars);
	}
	return createTranslator(DEFAULT_LOCALE, {})(key, vars);
};
