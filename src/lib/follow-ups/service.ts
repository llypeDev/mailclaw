import { and, desc, eq, inArray, lte } from "drizzle-orm";
import { getDb, type AppDatabase } from "@/db";
import { followUps, messages } from "@/db/schema";
import { isMissingTableError } from "@/lib/database-errors";
import { chunk } from "@/lib/email/attachment-storage-utils";
import { newId } from "@/lib/ids";
import { followUpDueAt, isReplyTo } from "./follow-up-utils";
import type { DueFollowUp, MessageFollowUp } from "./types";

/** Rows processed per cron run; the next run picks up the rest. */
const REMINDER_BATCH = 200;
const MAX_LISTED = 50;

/** Sent messages per reply lookup: at most 2 × 40 + 1 bound parameters, under D1's 100. */
const REPLY_LOOKUP_BATCH = 40;

type SentMessage = { mailboxId: string | null; threadId: string | null; createdAt: Date };

/** The sent messages from `sent` that an inbound message answered since (`isReplyTo`). */
async function findReplied<T extends SentMessage>(db: AppDatabase, sent: T[]): Promise<Set<T>> {
	const replied = new Set<T>();
	const threaded = sent.filter((row) => row.mailboxId && row.threadId);
	for (const batch of chunk(threaded, REPLY_LOOKUP_BATCH)) {
		// Every inbound message of these threads: threads are short, so this is a handful of rows read off
		// messages_thread_idx (mailbox_id, thread_id). `user_id` is selected only because no covering index
		// holds it; a query the folder's covering index can answer makes SQLite without statistics walk
		// the whole mailbox there instead.
		const candidates = await db
			.select({ mailboxId: messages.mailboxId, threadId: messages.threadId, direction: messages.direction, createdAt: messages.createdAt, userId: messages.userId })
			.from(messages)
			.where(and(
				inArray(messages.mailboxId, Array.from(new Set(batch.map((row) => row.mailboxId!)))),
				inArray(messages.threadId, Array.from(new Set(batch.map((row) => row.threadId!)))),
				eq(messages.direction, "inbound"),
			));
		for (const row of batch) {
			if (candidates.some((candidate) => isReplyTo(row, candidate))) replied.add(row);
		}
	}
	return replied;
}

async function markReplied(env: CloudflareEnv, ids: string[]): Promise<void> {
	if (ids.length === 0) return;
	await getDb(env).update(followUps).set({ status: "replied" }).where(inArray(followUps.id, ids));
}

/** Arms (or re-arms) the reminder on a sent message. */
export async function setFollowUp(env: CloudflareEnv, input: { messageId: string; userId: string; days: number; from?: Date }): Promise<MessageFollowUp> {
	const dueAt = followUpDueAt(input.from ?? new Date(), input.days);
	const [row] = await getDb(env)
		.insert(followUps)
		.values({ id: newId("fup"), messageId: input.messageId, userId: input.userId, dueAt })
		.onConflictDoUpdate({ target: followUps.messageId, set: { dueAt, status: "pending", userId: input.userId } })
		.returning({ id: followUps.id, status: followUps.status, dueAt: followUps.dueAt });
	return { id: row.id, status: row.status, dueAt: row.dueAt.toISOString() };
}

/** Five-minute cron: due reminders without a reply surface, the rest are closed as replied. */
export async function runFollowUpReminders(env: CloudflareEnv, now: Date): Promise<void> {
	try {
		const db = getDb(env);
		const rows = await db
			.select({ id: followUps.id, mailboxId: messages.mailboxId, threadId: messages.threadId, createdAt: messages.createdAt })
			.from(followUps)
			.innerJoin(messages, eq(messages.id, followUps.messageId))
			.where(and(eq(followUps.status, "pending"), lte(followUps.dueAt, now)))
			.limit(REMINDER_BATCH);
		const replied = await findReplied(db, rows);
		await markReplied(env, rows.filter((row) => replied.has(row)).map((row) => row.id));
		const due = rows.filter((row) => !replied.has(row)).map((row) => row.id);
		if (due.length) await db.update(followUps).set({ status: "due" }).where(inArray(followUps.id, due));
	} catch (error) {
		if (!isMissingTableError(error)) throw error;
	}
}

/** The user's reminders that came due without a reply, newest first. A reply that arrived since closes them. */
export async function listDueFollowUps(env: CloudflareEnv, userId: string, mailboxId?: string | null): Promise<DueFollowUp[]> {
	try {
		const db = getDb(env);
		const rows = await db
			.select({
				id: followUps.id,
				messageId: followUps.messageId,
				dueAt: followUps.dueAt,
				mailboxId: messages.mailboxId,
				threadId: messages.threadId,
				subject: messages.subject,
				toAddr: messages.toAddr,
				createdAt: messages.createdAt,
			})
			.from(followUps)
			.innerJoin(messages, eq(messages.id, followUps.messageId))
			.where(and(
				eq(followUps.userId, userId),
				eq(followUps.status, "due"),
				...(mailboxId ? [eq(messages.mailboxId, mailboxId)] : []),
			))
			.orderBy(desc(followUps.dueAt))
			.limit(MAX_LISTED);
		const replied = await findReplied(db, rows);
		await markReplied(env, rows.filter((row) => replied.has(row)).map((row) => row.id));
		return rows.filter((row) => !replied.has(row)).map((row) => ({
			id: row.id,
			messageId: row.messageId,
			mailboxId: row.mailboxId,
			subject: row.subject,
			toAddr: row.toAddr,
			sentAt: row.createdAt.toISOString(),
			dueAt: row.dueAt.toISOString(),
		}));
	} catch (error) {
		if (isMissingTableError(error)) return [];
		throw error;
	}
}

export async function getMessageFollowUp(env: CloudflareEnv, userId: string, messageId: string): Promise<MessageFollowUp | null> {
	try {
		const db = getDb(env);
		const [row] = await db
			.select({ id: followUps.id, status: followUps.status, dueAt: followUps.dueAt, mailboxId: messages.mailboxId, threadId: messages.threadId, createdAt: messages.createdAt })
			.from(followUps)
			.innerJoin(messages, eq(messages.id, followUps.messageId))
			.where(and(eq(followUps.messageId, messageId), eq(followUps.userId, userId)))
			.limit(1);
		if (!row) return null;
		const open = row.status === "pending" || row.status === "due";
		const replied = open && (await findReplied(db, [row])).has(row);
		if (replied) await markReplied(env, [row.id]);
		return { id: row.id, status: replied ? "replied" : row.status, dueAt: row.dueAt.toISOString() };
	} catch (error) {
		if (isMissingTableError(error)) return null;
		throw error;
	}
}

/** Dismisses the user's reminder, or pushes it back by `snoozeDays`. Returns false when it is not theirs. */
export async function updateFollowUp(
	env: CloudflareEnv,
	userId: string,
	id: string,
	change: { action: "dismiss" } | { action: "snooze"; days: number },
): Promise<boolean> {
	const set = change.action === "dismiss"
		? { status: "dismissed" as const }
		: { status: "pending" as const, dueAt: followUpDueAt(new Date(), change.days) };
	const updated = await getDb(env)
		.update(followUps)
		.set(set)
		.where(and(eq(followUps.id, id), eq(followUps.userId, userId)))
		.returning({ id: followUps.id });
	return updated.length > 0;
}
