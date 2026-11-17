/** Conditional and partial responses for stored objects (attachments, avatars, Drive files). */

export type ByteRange = { offset: number; length: number };

function stripWeak(tag: string): string {
	return tag.startsWith("W/") ? tag.slice(2) : tag;
}

/**
 * Whether an If-None-Match header names `etag` (weak comparison, RFC 9110
 * section 13.1.2), so a GET may answer 304. `etag` is the quoted form, e.g.
 * R2's `httpEtag`.
 */
export function etagMatches(ifNoneMatch: string | null | undefined, etag: string | null | undefined): boolean {
	if (!ifNoneMatch || !etag) return false;
	const value = ifNoneMatch.trim();
	if (value === "*") return true;
	const wanted = stripWeak(etag.trim());
	return value.split(",").some((candidate) => stripWeak(candidate.trim()) === wanted);
}

/**
 * Resolves a `Range` header against an object of `size` bytes. Only a single
 * `bytes=` range is honoured; anything else (several ranges, other units,
 * malformed values) returns null and the whole object is served, as RFC 9110
 * allows. "unsatisfiable" means the range lies past the end: answer 416.
 */
export function parseByteRange(header: string | null | undefined, size: number): ByteRange | "unsatisfiable" | null {
	if (!header) return null;
	const match = /^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/i.exec(header);
	if (!match) return null;
	const [, startText, endText] = match;
	if (!startText && !endText) return null;
	if (!startText) {
		const suffix = Number(endText);
		if (!Number.isSafeInteger(suffix)) return null;
		if (suffix === 0 || size === 0) return "unsatisfiable";
		const length = Math.min(suffix, size);
		return { offset: size - length, length };
	}
	const start = Number(startText);
	if (!Number.isSafeInteger(start)) return null;
	const end = endText ? Number(endText) : Number.MAX_SAFE_INTEGER;
	if (!Number.isSafeInteger(end) || end < start) return null;
	if (start >= size) return "unsatisfiable";
	const last = Math.min(end, size - 1);
	return { offset: start, length: last - start + 1 };
}

export function formatContentRange(range: ByteRange, size: number): string {
	return `bytes ${range.offset}-${range.offset + range.length - 1}/${size}`;
}

/**
 * If-Range (RFC 9110 section 13.1.5): a Range only applies while the client's
 * copy is current. Only strong entity tags are compared; a date or weak tag
 * never matches, so the whole object is sent.
 */
export function ifRangeAllows(ifRange: string | null | undefined, etag: string | null | undefined): boolean {
	if (!ifRange) return true;
	const value = ifRange.trim();
	if (!etag || value.startsWith("W/") || !value.startsWith("\"")) return false;
	return value === etag.trim();
}
