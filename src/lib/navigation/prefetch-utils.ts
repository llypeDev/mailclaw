/**
 * How long one prefetched message route stands in for its whole folder. The
 * router learns a reusable route template from it, so later rows navigate
 * optimistically without a prefetch of their own.
 */
export const ROUTE_TEMPLATE_PREFETCH_TTL_MS = 5 * 60_000;

/**
 * The folder a message detail href belongs to: its path without the final
 * (message id) segment, query or hash. `/folders/abc/msg1` -> `/folders/abc`.
 */
export function getRouteTemplateKey(href: string): string {
	const path = href.split(/[?#]/, 1)[0].replace(/\/+$/, "");
	const slash = path.lastIndexOf("/");
	return slash > 0 ? path.slice(0, slash) : path || "/";
}

/**
 * Records that `key` is being prefetched now unless it already was within
 * `ttlMs`. Returns true when the caller should issue the prefetch.
 */
export function claimRouteTemplatePrefetch(
	registry: Map<string, number>,
	key: string,
	now: number,
	ttlMs = ROUTE_TEMPLATE_PREFETCH_TTL_MS,
): boolean {
	const last = registry.get(key);
	if (last !== undefined && now - last < ttlMs) return false;
	registry.set(key, now);
	return true;
}
