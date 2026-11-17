/**
 * The list total belongs to a view (folder, mailbox, filters), not to a page, so it is cached under
 * the list's query string without `limit` and `offset`: paging through a folder counts it once.
 */
export function getMessageTotalKey(params: URLSearchParams): string {
	const view = new URLSearchParams(params);
	view.delete("limit");
	view.delete("offset");
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
