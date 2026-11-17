import { authFetch, AUTH_SESSION_CHANGED_EVENT } from "@/lib/auth/client";
import { isReadOnlyChange, MESSAGES_CHANGED_EVENT } from "@/lib/messages/change-events";
import { getMessageTotalKey, isReadFilteredTotalKey } from "./message-total-utils";

/**
 * List totals per view. A list page carries its total only when the page proves it (the last page);
 * otherwise the total is counted once per view with `count=only` and reused while paging.
 */
const totals = new Map<string, number>();
const requests = new Map<string, Promise<number | null>>();
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
	window.addEventListener(AUTH_SESSION_CHANGED_EVENT, clearAll);
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
