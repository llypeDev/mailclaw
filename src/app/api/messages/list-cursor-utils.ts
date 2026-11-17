import { and, eq, gt, gte, lte, not, or } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { messages } from "@/db/schema";
import type { ListCursor } from "./types";

const CURSOR_VERSION = "k1";

/** The latest representable date: an upper bound that never excludes a message. */
export const LIST_TOP = new Date(8.64e15);

function toBase64Url(text: string): string {
	let binary = "";
	for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): string | null {
	if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
	try {
		const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
		return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
	} catch {
		return null;
	}
}

/**
 * The opaque `nextCursor` of a list page: the sort key (created_at in whole
 * seconds, as stored, and id) of the page's last row. The next page starts
 * strictly after it.
 */
export function encodeListCursor(row: { createdAt: Date; id: string }): string {
	return toBase64Url(`${CURSOR_VERSION}:${Math.floor(row.createdAt.getTime() / 1000)}:${row.id}`);
}

/** Null for anything `encodeListCursor` did not produce. */
export function decodeListCursor(value: string | null | undefined): ListCursor | null {
	if (!value || value.length > 512) return null;
	const text = fromBase64Url(value);
	const match = text ? /^k1:(-?\d{1,15}):(.+)$/s.exec(text) : null;
	if (!match) return null;
	const seconds = Number(match[1]);
	if (!Number.isSafeInteger(seconds)) return null;
	return { createdAt: new Date(seconds * 1000), id: match[2] };
}

/**
 * The page bound added to a list query, ordered by (created_at DESC, id DESC).
 *
 * `seek` is for views whose page index has created_at right after its
 * equality columns (every folder, Starred, and the unread filter on them): the
 * bound is then a range on created_at that the index can start from, so a deep
 * page reads only its own rows. Without a cursor it is an open upper bound,
 * which changes no result but is what makes SQLite pick that index for the
 * all-mailbox lists: with `mailbox_id IN (...)` and no range it prefers
 * messages_counts_cover_idx (more equality columns) and sorts the whole
 * folder, while with the range it walks messages_nav_cover_idx per mailbox and
 * stops each walk once the page is full.
 *
 * Other views (search, Snoozed, Scheduled) are served by a different index, so
 * they get the same predicate in a negated form that is not a range and leaves
 * the planner's choice alone, and nothing at all without a cursor.
 */
export function listPageBound(cursor: ListCursor | null, seek: boolean): SQL | undefined {
	if (!cursor) return seek ? lte(messages.createdAt, LIST_TOP) : undefined;
	const sameSecondAtOrAbove = and(eq(messages.createdAt, cursor.createdAt), gte(messages.id, cursor.id))!;
	if (seek) return and(lte(messages.createdAt, cursor.createdAt), not(sameSecondAtOrAbove));
	return not(or(gt(messages.createdAt, cursor.createdAt), sameSecondAtOrAbove)!);
}
