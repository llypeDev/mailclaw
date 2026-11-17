/**
 * The list total belongs to a view (folder, mailbox, filters), not to a page, so it is cached under
 * the list's query string without `limit`, `offset` and `cursor`: paging through a folder counts it once.
 */
export function getMessageTotalKey(params: URLSearchParams): string {
	const view = new URLSearchParams(params);
	view.delete("limit");
	view.delete("offset");
	view.delete("cursor");
	view.delete("count");
	view.sort();
	return view.toString();
}

/** A read flip only changes the total of views filtered on read state. */
export function isReadFilteredTotalKey(key: string): boolean {
	return new URLSearchParams(key).has("read");
}

/** Whether a next page exists. Responses from before `hasMore` existed carry only the total. */
export function hasNextMessagePage(response: { hasMore?: boolean; total?: number | null }, offset: number, count: number): boolean {
	if (typeof response.hasMore === "boolean") return response.hasMore;
	return typeof response.total === "number" && offset + count < response.total;
}

/**
 * Keyset cursors of the pages of one view, by offset: the page at `offset + limit` starts at the
 * `nextCursor` of the page at `offset`. Pages are reached one step at a time from the first, so
 * stepping back finds the cursor that loaded the previous page; an offset without one (a jump to the
 * last page) is loaded by offset.
 */
export type MessagePageCursors = Map<number, string>;

/** The page params with the cursor for its offset, when one is known. */
export function withPageCursor(params: URLSearchParams, pages: MessagePageCursors | undefined): URLSearchParams {
	const offset = Number(params.get("offset") ?? 0);
	const cursor = offset > 0 ? pages?.get(offset) : undefined;
	if (!cursor) return params;
	const next = new URLSearchParams(params);
	next.set("cursor", cursor);
	return next;
}

/**
 * Records where the page after `offset` starts. Cursors further on were taken from an earlier
 * version of the pages in between, so they are dropped and those pages load from this one onward.
 */
export function rememberPageCursor(pages: MessagePageCursors, offset: number, limit: number, nextCursor: string | null | undefined) {
	const next = offset + limit;
	for (const known of Array.from(pages.keys())) {
		if (known > next) pages.delete(known);
	}
	if (nextCursor) pages.set(next, nextCursor);
	else pages.delete(next);
}
