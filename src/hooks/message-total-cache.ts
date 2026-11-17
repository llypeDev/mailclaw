import { authFetch, AUTH_SESSION_CHANGED_EVENT } from "@/lib/auth/client";
import { isReadOnlyChange, MESSAGES_CHANGED_EVENT } from "@/lib/messages/change-events";
import { getMessageTotalKey, isReadFilteredTotalKey, rememberPageCursor, withPageCursor } from "./message-total-utils";
import type { MessagePageCursors } from "./message-total-utils";

/**
 * List totals per view. A list page carries its total only when the page proves it (the last page);
 * otherwise the total is counted once per view with `count=only` and reused while paging.
 */
const totals = new Map<string, number>();
const requests = new Map<string, Promise<number | null>>();
/**
 * Keyset cursors per view (see `withPageCursor`). They outlive message changes: a cursor is a
 * position in the sort order, still valid after the rows around it moved, so a refreshed page
 * keeps its place instead of shifting by the rows deleted before it.
 */
const pageCursors = new Map<string, MessagePageCursors>();
let generation = 0;

function clearAll() {
	generation += 1;
	totals.clear();
	requests.clear();
}

if (typeof window !== "undefined") {
	window.addEventListener(MESSAGES_CHANGED_EVENT, (event) => {
		if (!isReadOnlyChange(event)) {
			clearAll();
			return;
		}
		generation += 1;
		for (const key of Array.from(totals.keys())) {
			if (isReadFilteredTotalKey(key)) totals.delete(key);
		}
		requests.clear();
	});
	window.addEventListener(AUTH_SESSION_CHANGED_EVENT, () => {
		clearAll();
		pageCursors.clear();
	});
}

export function peekMessageTotal(params: URLSearchParams): number | undefined {
	return totals.get(getMessageTotalKey(params));
}

export function rememberMessageTotal(params: URLSearchParams, total: number) {
	totals.set(getMessageTotalKey(params), total);
}

/** Counts the view `params` lists; null when the request fails. */
export function fetchMessageTotal(params: URLSearchParams): Promise<number | null> {
	const key = getMessageTotalKey(params);
	const cached = totals.get(key);
	if (cached !== undefined) return Promise.resolve(cached);
	const pending = requests.get(key);
	if (pending) return pending;
	const requestGeneration = generation;
	const query = new URLSearchParams(key);
	query.set("count", "only");
	const request = authFetch(`/api/messages?${query.toString()}`)
		.then(async (res) => {
			if (!res.ok) return null;
			const data = (await res.json()) as { total?: unknown };
			const total = typeof data.total === "number" ? data.total : null;
			if (total !== null && requestGeneration === generation) totals.set(key, total);
			return total;
		})
		.catch(() => null)
		.finally(() => {
			if (requests.get(key) === request) requests.delete(key);
		});
	requests.set(key, request);
	return request;
}

/** The list params for a page, with the keyset cursor that starts it when this view has one. */
export function getMessagePageParams(params: URLSearchParams): URLSearchParams {
	return withPageCursor(params, pageCursors.get(getMessageTotalKey(params)));
}

/** Records the `nextCursor` a page of this view returned, for the page after it. */
export function rememberMessagePageCursor(params: URLSearchParams, offset: number, limit: number, nextCursor: string | null | undefined) {
	const key = getMessageTotalKey(params);
	let pages = pageCursors.get(key);
	if (!pages) {
		if (!nextCursor) return;
		pages = new Map();
		pageCursors.set(key, pages);
	}
	rememberPageCursor(pages, offset, limit, nextCursor);
}

/** Drops the view's cursors, so its pages load by offset. */
export function forgetMessagePageCursors(params: URLSearchParams) {
	pageCursors.delete(getMessageTotalKey(params));
}
