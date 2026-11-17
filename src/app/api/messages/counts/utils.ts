import type { MessageCounts, MessageFolder } from "@/hooks/types";
import type { CounterRow } from "@/lib/messages/counters-types";
import type { CountableFolder, MessageCountRow, SnoozedCountRow } from "./types";

export function getMessageFolder(row: MessageCountRow): CountableFolder {
	if (row.snoozedUntil && row.snoozedUntil > new Date()) return "snoozed";
	if (row.status === "trash") return "trash";
	if (row.status === "spam") return "spam";
	if (row.status === "archived") return "archived";
	if (row.direction === "inbound" && row.status === "received" && !row.folderId) return "inbox";
	if (row.direction === "outbound" && row.status === "sent") return "sent";
	if (row.direction === "outbound" && row.status === "draft") return "drafts";
	return null;
}

export function createEmptyFolderCounts(): MessageCounts["folders"] {
	return {
		inbox: { total: 0, unread: 0 },
		starred: { total: 0, unread: 0 },
		snoozed: { total: 0, unread: 0 },
		sent: { total: 0, unread: 0 },
		scheduled: { total: 0, unread: 0 },
		drafts: { total: 0, unread: 0 },
		archived: { total: 0, unread: 0 },
		spam: { total: 0, unread: 0 },
		trash: { total: 0, unread: 0 },
	};
}

export function buildMessageCounts(rows: MessageCountRow[]): MessageCounts {
	const folders = createEmptyFolderCounts();
	const customFolders: MessageCounts["customFolders"] = {};
	const mailboxMap = new Map<string, { mailboxId: string; total: number; unread: number; inbox: number }>();

	for (const row of rows) {
		const weight = row.total ?? 1;
		const folder = getMessageFolder(row);
		const unread = row.direction === "inbound" && !row.read;
		if (row.starred) {
			folders.starred.total += weight;
			if (unread) folders.starred.unread += weight;
		}
		if (folder) {
			folders[folder].total += weight;
			if (unread) folders[folder].unread += weight;
		}

		if (row.folderId) {
			const folderCount = customFolders[row.folderId] ?? { total: 0, unread: 0 };
			folderCount.total += weight;
			if (unread) folderCount.unread += weight;
			customFolders[row.folderId] = folderCount;
		}

		if (!row.mailboxId) continue;

		const mailboxCount = mailboxMap.get(row.mailboxId) ?? {
			mailboxId: row.mailboxId,
			total: 0,
			unread: 0,
			inbox: 0,
		};
		mailboxCount.total += weight;
		if (unread) mailboxCount.unread += weight;
		if (folder === "inbox") mailboxCount.inbox += weight;
		mailboxMap.set(row.mailboxId, mailboxCount);
	}

	return {
		folders,
		customFolders,
		mailboxes: Array.from(mailboxMap.values()),
	};
}

export function getFolderLabelCount(folder: MessageFolder, counts: MessageCounts["folders"]) {
	return counts[folder].unread;
}

/** Stands in for any snooze end the database already found to be in the future. */
const SNOOZED = new Date(8.64e15);

/**
 * The rows `buildMessageCounts` would get from grouping every message, built
 * from the stored tallies plus the messages snoozed right now. Tallies cannot
 * tell snoozed messages apart (a snooze ends with the clock, not a write), so
 * each live snoozed group is added as snoozed and taken back out of the plain
 * tallies with a negative weight. `buildMessageCounts` is linear in `total`, so
 * the pair moves those messages from their folder to Snoozed (and out of the
 * mailbox's inbox figure) while totals, unread, starred and custom folders
 * keep counting them once, exactly as the grouped query did.
 */
export function withLiveSnoozedRows(tallies: CounterRow[], snoozed: SnoozedCountRow[]): MessageCountRow[] {
	const rows: MessageCountRow[] = tallies.map((row) => ({ ...row, snoozedUntil: null }));
	for (const group of snoozed) {
		const total = Number(group.total) || 0;
		if (!total) continue;
		rows.push({ ...group, snoozedUntil: SNOOZED, total });
		rows.push({ ...group, snoozedUntil: null, total: -total });
	}
	return rows;
}
