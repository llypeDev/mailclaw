import { and, count, eq, gt, inArray, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { AppDatabase } from "@/db";
import { messages } from "@/db/schema";
import type { MessageCounts } from "@/hooks/types";
import { isMissingTableError } from "@/lib/database-errors";
import { scheduledMessageCondition } from "@/lib/email/scheduled";
import { selectCounterRows } from "@/lib/messages/counters";
import { mergeCounterRows } from "@/lib/messages/counters-utils";
import { buildMessageCounts, withLiveSnoozedRows } from "./utils";

/** The mailboxes to count, or, for a user with none, the messages they own. */
export type MessageCountScope = { mailboxIds: string[] } | { userId: string };

/**
 * Sidebar counts. Mailboxes are counted from `message_counters` (kept by
 * triggers), plus two live queries that stay small whatever the mailbox size:
 * messages snoozed right now (a range on messages_mailbox_snoozed_idx) and
 * queued scheduled sends. All three run in one batch so they see one snapshot.
 */
export async function loadMessageCounts(db: AppDatabase, scope: MessageCountScope): Promise<MessageCounts> {
	// Messages outside any mailbox have no tallies; a user without mailboxes owns few of them.
	if ("userId" in scope) return loadGroupedMessageCounts(db, eq(messages.userId, scope.userId));
	if (scope.mailboxIds.length === 0) return buildMessageCounts([]);

	const inScope = inArray(messages.mailboxId, scope.mailboxIds);
	const batch = db.batch([
		selectCounterRows(db, scope.mailboxIds),
		// One row per snoozed message, not grouped: a GROUP BY on these columns
		// makes SQLite walk the whole mailbox on messages_counts_cover_idx, which
		// yields them in group order, instead of taking the snoozed range.
		db
			.select({
				mailboxId: messages.mailboxId,
				folderId: messages.folderId,
				direction: messages.direction,
				status: messages.status,
				read: messages.read,
				starred: messages.starred,
			})
			.from(messages)
			.where(and(inScope, gt(messages.snoozedUntil, new Date()))),
		db.select({ total: count() }).from(messages).where(and(inScope, scheduledMessageCondition(db))),
	]);
	let results: Awaited<typeof batch>;
	try {
		results = await batch;
	} catch (error) {
		// Before migration 0089 there are no tallies yet.
		if (!isMissingTableError(error)) throw error;
		return loadGroupedMessageCounts(db, inScope);
	}
	const [stored, snoozed, scheduled] = results;

	const counts = buildMessageCounts(withLiveSnoozedRows(mergeCounterRows(stored), snoozed.map((row) => ({ ...row, total: 1 }))));
	counts.folders.scheduled.total = Number(scheduled[0]?.total ?? 0);
	return counts;
}

/**
 * Counts by grouping every message the condition matches: the query the
 * counters replaced. Kept for the user-owned scope, which has no tallies.
 */
export async function loadGroupedMessageCounts(db: AppDatabase, condition: SQL): Promise<MessageCounts> {
	const rows = await db
		.select({
			mailboxId: messages.mailboxId,
			folderId: messages.folderId,
			direction: messages.direction,
			status: messages.status,
			read: messages.read,
			starred: messages.starred,
			snoozedUntil: messages.snoozedUntil,
			total: count(),
			scheduledTotal: sql<number>`sum(case when ${scheduledMessageCondition(db)} then 1 else 0 end)`,
		})
		.from(messages)
		.where(condition)
		.groupBy(
			messages.mailboxId,
			messages.folderId,
			messages.direction,
			messages.status,
			messages.read,
			messages.starred,
			messages.snoozedUntil,
		);

	const counts = buildMessageCounts(rows);
	counts.folders.scheduled.total = rows.reduce((total, row) => total + (Number(row.scheduledTotal) || 0), 0);
	return counts;
}
