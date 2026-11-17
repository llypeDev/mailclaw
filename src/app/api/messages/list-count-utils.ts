import type { ListCountFilter, ListCountRow } from "./types";

/** Whether a message (or a counted group of messages) belongs to the list view. */
export function listCountRowMatches(row: ListCountRow, filter: ListCountFilter): boolean {
	if (filter.direction && row.direction !== filter.direction) return false;
	if (filter.status ? row.status !== filter.status : row.status === "template") return false;
	if (filter.folderId ? row.folderId !== filter.folderId : filter.inbox && row.folderId !== null) return false;
	if (filter.starred && !row.starred) return false;
	if (filter.read !== null && row.read !== filter.read) return false;
	return true;
}

/**
 * The list total from the stored tallies: every matching group, less the
 * messages snoozed right now when the view is the Inbox (tallies do not know
 * about snoozing; a snooze ends with the clock, not a write). Exact for the
 * views `ListCountFilter` describes, which is every list without a search,
 * Snoozed or Scheduled, ungrouped.
 */
export function countListFromTallies(
	tallies: Array<ListCountRow & { total: number }>,
	snoozedNow: ListCountRow[],
	filter: ListCountFilter,
): number {
	let total = 0;
	for (const row of tallies) if (listCountRowMatches(row, filter)) total += Number(row.total) || 0;
	if (filter.inbox) for (const row of snoozedNow) if (listCountRowMatches(row, filter)) total -= 1;
	return Math.max(total, 0);
}
