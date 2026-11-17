import type { DatabaseDialect } from "@/db/dialect";
import type { CounterRow, StoredCounterRow } from "./counters-types";

/**
 * Empties `message_counters` and recounts it from `messages`: the backfill of
 * migration 0089 (PostgreSQL/MySQL 0013), to run as one batch so readers never
 * see the table half built. `read` is quoted because MySQL reserves it.
 */
export function messageCounterRebuildStatements(dialect: DatabaseDialect): [string, string] {
	const read = dialect === "mysql" ? "`read`" : '"read"';
	const key = `mailbox_id, coalesce(folder_id, ''), direction, status, ${read}, starred`;
	return [
		"DELETE FROM message_counters",
		`INSERT INTO message_counters (mailbox_id, folder_key, direction, status, ${read}, starred, total) `
			+ `SELECT ${key}, count(*) FROM messages WHERE mailbox_id IS NOT NULL GROUP BY ${key}`,
	];
}

/**
 * Folds stored `message_counters` rows into one row per counted key. A key
 * naming a folder that no longer exists (`folderExists` 0) counts as no
 * folder, as its messages now have folder_id NULL: on MySQL, where foreign key
 * actions fire no triggers, those messages' later changes are taken out of
 * folder '' while the old key keeps them, so only the sum is right. Keys that
 * net to zero or less are dropped, since the GROUP BY they replace never
 * yields an empty group. Rows come back ordered by mailbox, then key.
 */
export function mergeCounterRows(rows: StoredCounterRow[]): CounterRow[] {
	const merged = new Map<string, CounterRow>();
	for (const row of rows) {
		const folderId = row.folderKey && Number(row.folderExists) === 1 ? row.folderKey : null;
		const read = !!row.read;
		const starred = !!row.starred;
		const key = JSON.stringify([row.mailboxId, folderId, row.direction, row.status, read, starred]);
		const current = merged.get(key);
		if (current) current.total += Number(row.total);
		else merged.set(key, { mailboxId: row.mailboxId, folderId, direction: row.direction, status: row.status, read, starred, total: Number(row.total) });
	}
	return [...merged.entries()]
		.filter(([, row]) => row.total > 0)
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		.map(([, row]) => row);
}
