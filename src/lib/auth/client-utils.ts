/**
 * The web client keeps no credential. The session is the httpOnly cookie;
 * localStorage holds only a random, non-secret marker that changes whenever
 * the signed-in account changes, so tabs and caches can tell "same session"
 * from "someone else signed in" (the `storage` event, cache keys).
 */
export const SESSION_MARKER_STORAGE_KEY = "mailclaw-session";

/** Where clients before the cookie-only change kept the session token itself. */
export const LEGACY_SESSION_TOKEN_STORAGE_KEY = "mailclaw-session-token";

export function createSessionMarker(randomBytes: (length: number) => Uint8Array = defaultRandomBytes): string {
	let hex = "";
	for (const byte of randomBytes(12)) hex += byte.toString(16).padStart(2, "0");
	return `s1.${hex}`;
}

function defaultRandomBytes(length: number): Uint8Array {
	return crypto.getRandomValues(new Uint8Array(length));
}

/**
 * A stable marker for a legacy token: the same before and after the token is
 * moved into the cookie, so the move does not look like an account switch.
 * 32-bit FNV-1a keeps nothing useful about a 120-bit token.
 */
export function legacySessionMarker(token: string): string {
	let hash = 0x811c9dc5;
	for (let index = 0; index < token.length; index += 1) {
		hash ^= token.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return `l1.${hash.toString(16).padStart(8, "0")}`;
}

export function readSessionMarker(storage: Pick<Storage, "getItem">): string | null {
	const marker = storage.getItem(SESSION_MARKER_STORAGE_KEY);
	if (marker) return marker;
	const legacy = storage.getItem(LEGACY_SESSION_TOKEN_STORAGE_KEY);
	return legacy ? legacySessionMarker(legacy) : null;
}

export type LegacyMigrationOutcome =
	/** The cookie now carries the legacy session: keep its marker, drop the token. */
	| { kind: "migrated" }
	/** The cookie signs in someone (else): drop the token, start a fresh marker. */
	| { kind: "replaced" }
	/** Neither works: drop the token; the next request's 401 signs the tab out. */
	| { kind: "dropped" }
	/** The browser would not keep the cookie, or the network failed: keep using the token. */
	| { kind: "kept" };

/**
 * Decide what to do with a legacy token from the two answers: the POST that
 * moved it into the cookie (null on a network error) and the cookie-only GET
 * that followed it.
 */
export function decideLegacyMigration(
	adopt: { status: number; userId?: string } | null,
	check: { status: number; userId?: string } | null,
): LegacyMigrationOutcome {
	if (!adopt || !check) return { kind: "kept" };
	const cookieUser = check.status === 200 ? check.userId : undefined;
	if (adopt.status === 200 && adopt.userId) {
		if (cookieUser === adopt.userId) return { kind: "migrated" };
		// The token is live but the cookie did not stick (a Secure cookie over http).
		return { kind: "kept" };
	}
	if (adopt.status === 401) return cookieUser ? { kind: "replaced" } : { kind: "dropped" };
	return { kind: "kept" };
}
