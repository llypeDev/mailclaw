import type { Locale, Messages } from "./types";

type Catalog = Partial<Messages>;
type Entry = { promise: Promise<Catalog>; value?: Catalog; failed?: boolean };
type LoadOptions = {
	/** Replace a cached entry (development, where catalogs change). */
	reload?: boolean;
	/**
	 * Resolve to this instead of rejecting, and keep it until a caller passes `retryFailed`. A render that
	 * suspends on the catalog needs a stable answer even offline, or it would refetch on every retry.
	 */
	fallback?: Catalog;
	/** Load again if the cached entry is a fallback from a failed load. */
	retryFailed?: boolean;
};

// Kept on `globalThis` rather than in module scope: the server renders server components and the HTML of
// client components in separate module graphs (vinext's `rsc` and `ssr` environments, Next's layers) that
// share one isolate. The root layout loads the catalog in the first; `LanguageProvider` reads it in the
// second, so the catalog never has to travel inside the page's RSC payload. In the browser it is the
// per-tab cache of catalogs fetched from `/locales/<code>.json`.
const STORE_KEY = Symbol.for("mailclaw.i18n.catalogs");

/**
 * Marks a settled promise the way React's `use()` reads it, so a component rendering with a catalog that
 * has already loaded gets it synchronously instead of suspending for a tick.
 */
function markFulfilled(promise: Promise<Catalog>, value: Catalog): void {
	Object.assign(promise, { status: "fulfilled", value });
}

function store(): Map<Locale, Entry> {
	const holder = globalThis as typeof globalThis & { [STORE_KEY]?: Map<Locale, Entry> };
	holder[STORE_KEY] ??= new Map();
	return holder[STORE_KEY];
}

/** The parsed catalog if it has already loaded here, without waiting. */
export function peekCatalog(locale: Locale): Catalog | undefined {
	return store().get(locale)?.value;
}

/**
 * The catalog for `locale`, loaded once per isolate (server) or tab (browser) and shared by every later
 * caller. The returned promise is stable, so React's `use()` can suspend on it. Without a `fallback` a
 * failed load is forgotten so the next caller retries.
 */
export function loadCatalog(locale: Locale, load: () => Promise<Catalog>, { reload = false, fallback, retryFailed = false }: LoadOptions = {}): Promise<Catalog> {
	const catalogs = store();
	const cached = catalogs.get(locale);
	if (cached && !reload && !(retryFailed && cached.failed)) return cached.promise;
	const entry: Entry = {
		promise: load().then(
			(value) => {
				entry.value = value;
				markFulfilled(entry.promise, value);
				return value;
			},
			(error: unknown) => {
				if (fallback) {
					entry.value = fallback;
					entry.failed = true;
					markFulfilled(entry.promise, fallback);
					return fallback;
				}
				if (catalogs.get(locale) === entry) catalogs.delete(locale);
				throw error;
			},
		),
	};
	// Development reloads keep serving the previous catalog until the new one has arrived.
	if (cached?.value && reload && !cached.failed) entry.value = cached.value;
	catalogs.set(locale, entry);
	return entry.promise;
}

/** Records a catalog obtained some other way (passed in as a prop, or fetched for a language switch). */
export function rememberCatalog(locale: Locale, value: Catalog): void {
	if (store().get(locale)?.value === value) return;
	const promise = Promise.resolve(value);
	markFulfilled(promise, value);
	store().set(locale, { promise, value });
}
