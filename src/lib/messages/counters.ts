import { and, eq, inArray, ne, sql } from "drizzle-orm";
import type { AppDatabase } from "@/db";
import type { DatabaseDialect } from "@/db/dialect";
import { dialectOf } from "@/db/introspect";
import { folders, messageCounters } from "@/db/schema";
import { isMissingTableError } from "@/lib/database-errors";
import { mergeCounterRows, messageCounterRebuildStatements } from "./counters-utils";
import type { CounterRow } from "./counters-types";

/**
 * The `message_counters` query for a set of mailboxes (migration 0089). It reads
 * one row per key in use, however many messages the mailboxes hold. Pass it to
 * `db.batch` with live queries that must see the same snapshot, then fold the
 * result with `mergeCounterRows`.
 */
export function selectCounterRows(db: AppDatabase, mailboxIds: string[]) {
	return db
		.select({
			mailboxId: messageCounters.mailboxId,
			folderKey: messageCounters.folderKey,
			// An integer rather than a boolean expression, which drivers return in different shapes.
			folderExists: sql<number>`case when ${folders.id} is null then 0 else 1 end`,
			direction: messageCounters.direction,
			status: messageCounters.status,
			read: messageCounters.read,
			starred: messageCounters.starred,
			total: messageCounters.total,
		})
		.from(messageCounters)
		.leftJoin(folders, eq(folders.id, messageCounters.folderKey))
		.where(and(inArray(messageCounters.mailboxId, mailboxIds), ne(messageCounters.total, 0)));
}

/** Message tallies per mailbox, folder, direction, status, read and starred. */
export async function loadCounterRows(db: AppDatabase, mailboxIds: string[]): Promise<CounterRow[]> {
	if (mailboxIds.length === 0) return [];
	return mergeCounterRows(await selectCounterRows(db, mailboxIds));
}

/**
 * Recounts `message_counters` from `messages` in one batch, which is one
 * transaction on every dialect whose driver can hold one (D1 batches are atomic).
 */
export async function rebuildMessageCounters(db: D1Database, dialect: DatabaseDialect = dialectOf(db)): Promise<void> {
	await db.batch(messageCounterRebuildStatements(dialect).map((statement) => db.prepare(statement)));
}

/**
 * Daily repair for MySQL, which fires no triggers for foreign key actions: a
 * purged account's messages leave by cascade from `users`, so tallies of a
 * mailbox shared with another account stay too high until recounted. SQLite and
 * PostgreSQL triggers see cascades, so elsewhere this does nothing. Returns
 * whether it rebuilt; failures are only logged.
 */
export async function runMessageCounterRebuild(env: Pick<CloudflareEnv, "DB">): Promise<boolean> {
	if (!env.DB || dialectOf(env.DB) !== "mysql") return false;
	try {
		await rebuildMessageCounters(env.DB, "mysql");
		return true;
	} catch (error) {
		// Before migration 0013 there is nothing to rebuild.
		if (!isMissingTableError(error)) console.error("Message counter rebuild failed", error);
		return false;
	}
}
