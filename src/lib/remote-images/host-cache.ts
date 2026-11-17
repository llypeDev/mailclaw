/** How long one isolate reuses a host's resolved addresses. */
export const REMOTE_IMAGE_HOST_CACHE_TTL_MS = 60_000;
export const REMOTE_IMAGE_HOST_CACHE_MAX_ENTRIES = 256;

type CachedHost = { addresses: Promise<string[]>; expiresAt: number };

/**
 * Wraps a host resolver so a newsletter's thirty images on the same CDN cost
 * one pair of DNS lookups instead of thirty. Concurrent lookups for a host
 * share one request; failures are not kept, so the next image retries. The
 * caller still checks every returned address, cached or not.
 */
export function createCachedHostResolver(
	resolve: (hostname: string) => Promise<string[]>,
	options: { ttlMs?: number; maxEntries?: number; now?: () => number } = {},
): (hostname: string) => Promise<string[]> {
	const ttlMs = options.ttlMs ?? REMOTE_IMAGE_HOST_CACHE_TTL_MS;
	const maxEntries = options.maxEntries ?? REMOTE_IMAGE_HOST_CACHE_MAX_ENTRIES;
	const now = options.now ?? Date.now;
	const entries = new Map<string, CachedHost>();

	return (hostname) => {
		const key = hostname.toLowerCase();
		const current = now();
		const cached = entries.get(key);
		if (cached && cached.expiresAt > current) return cached.addresses;
		if (cached) entries.delete(key);

		const addresses = resolve(key);
		const entry: CachedHost = { addresses, expiresAt: current + ttlMs };
		entries.set(key, entry);
		addresses.catch(() => {
			if (entries.get(key) === entry) entries.delete(key);
		});
		// Map keeps insertion order, so the first key is the oldest.
		while (entries.size > maxEntries) {
			const oldest = entries.keys().next().value;
			if (oldest === undefined) break;
			entries.delete(oldest);
		}
		return addresses;
	};
}
