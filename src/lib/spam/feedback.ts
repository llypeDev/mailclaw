import { eq, inArray, sql } from "drizzle-orm";
import { getDb, type AppDatabase } from "@/db";
import { messages, spamFeedback, spamReputation, spamTokenStats } from "@/db/schema";
import { excluded, greatest } from "@/db/sql";
import { getMailboxAccessLevel } from "@/lib/mailboxes/access";
import type { AuditLogInput, MailboxAccessLevel } from "@/lib/mailboxes/types";
import type { SessionUser } from "@/lib/auth/types";
import { createAuditLogs } from "@/lib/mailboxes/audit";
import { chunk } from "@/lib/email/attachment-storage-utils";
import { buildFingerprint, prepareSpamContent, tokenizeMessage } from "./tokenizer";
import { getReputationKeys } from "./analyzers/reputation";
import type { ReputationKey, SpamClassification } from "./types";
import { TOKENIZER_VERSION } from "./weights";
import { FEEDBACK_ID_BATCH, FEEDBACK_STATEMENT_BATCH, planSpamFeedback } from "./feedback-utils";

/** Columns the classifier trains on; the rest of the row is never read. */
const contentColumns = {
	id: messages.id,
	subject: messages.subject,
	textBody: messages.textBody,
	htmlBody: messages.htmlBody,
	providerMessageId: messages.providerMessageId,
	fromAddr: messages.fromAddr,
	toAddr: messages.toAddr,
	ccAddr: messages.ccAddr,
	bccAddr: messages.bccAddr,
	replyTo: messages.replyTo,
	inReplyTo: messages.inReplyTo,
	references: messages.references,
	createdAt: messages.createdAt,
};

type ContentRow = Pick<typeof messages.$inferSelect, keyof typeof contentColumns>;
type Training = { tokens: string[]; keys: ReputationKey[] };

function trainingFor(message: ContentRow): Training {
	const parsed = {
		subject: message.subject, text: message.textBody, html: message.htmlBody,
		messageId: message.providerMessageId, fromAddr: message.fromAddr, toAddr: message.toAddr,
		ccAddr: message.ccAddr, bccAddr: message.bccAddr, replyTo: message.replyTo, inReplyTo: message.inReplyTo,
		references: message.references?.split(/\s+/).filter(Boolean) ?? [], date: message.createdAt,
		attachments: [],
	};
	const prepared = prepareSpamContent(parsed);
	return { tokens: tokenizeMessage(parsed, prepared), keys: getReputationKeys(parsed, buildFingerprint(parsed, prepared)) };
}

/** The statements that move one message's training from `previous` (if any) to `classification`. */
function feedbackStatements(
	db: AppDatabase,
	input: Training & { messageId: string; mailboxId: string; previous: SpamClassification | null },
	classification: SpamClassification,
	actorUserId: string,
	now: Date,
): Array<PromiseLike<unknown>> {
	const { messageId, mailboxId, tokens, keys } = input;
	const statements: Array<PromiseLike<unknown>> = [];
	const addCounts = (target: SpamClassification, amount: 1 | -1) => {
		const spamCount = target === "spam" ? amount : 0;
		const hamCount = target === "ham" ? amount : 0;
		for (const token of tokens) {
			statements.push(db.insert(spamTokenStats).values({ mailboxId, token, spamCount, hamCount, updatedAt: now }).onConflictDoUpdate({
				target: [spamTokenStats.mailboxId, spamTokenStats.token],
				set: {
					spamCount: greatest(0, sql`${spamTokenStats.spamCount} + ${excluded(spamTokenStats.spamCount)}`),
					hamCount: greatest(0, sql`${spamTokenStats.hamCount} + ${excluded(spamTokenStats.hamCount)}`),
					updatedAt: now,
				},
			}));
		}
		for (const item of keys) {
			statements.push(db.insert(spamReputation).values({
				mailboxId, type: item.type, key: item.key, messagesSeen: amount > 0 ? 1 : 0, spamCount, hamCount, firstSeenAt: now, lastSeenAt: now,
			}).onConflictDoUpdate({
				target: [spamReputation.mailboxId, spamReputation.type, spamReputation.key],
				set: {
					messagesSeen: greatest(sql`${spamReputation.messagesSeen}`, sql`${excluded(spamReputation.messagesSeen)}`),
					spamCount: greatest(0, sql`${spamReputation.spamCount} + ${excluded(spamReputation.spamCount)}`),
					hamCount: greatest(0, sql`${spamReputation.hamCount} + ${excluded(spamReputation.hamCount)}`),
					lastSeenAt: now,
				},
			}));
		}
	};
	if (input.previous) addCounts(input.previous, -1);
	addCounts(classification, 1);
	statements.push(db.insert(spamFeedback).values({
		messageId, mailboxId, actorUserId, classification, trainingTokens: JSON.stringify(tokens),
		reputationKeys: JSON.stringify(keys), tokenizerVersion: TOKENIZER_VERSION, createdAt: now, updatedAt: now,
	}).onConflictDoUpdate({
		target: spamFeedback.messageId,
		set: { actorUserId, classification, updatedAt: now },
	}));
	statements.push(db.update(messages).set({ status: classification === "spam" ? "spam" : "received", folderId: null }).where(eq(messages.id, messageId)));
	return statements;
}

/**
 * Trains the mailbox's classifier and reputation on the user's verdict for each message and moves it
 * to Spam (`spam`) or the inbox (`ham`). Per message this does what `applySpamFeedback` always did;
 * the reads, the move-only updates and the audit rows are batched, bodies are read only for messages
 * never trained before, and training statements of several messages share one `batch`.
 * Only inbound mail in mailboxes the user can manage (`accessFor`) is touched. Returns the applied ids.
 */
export async function applySpamFeedbackToMessages(
	env: CloudflareEnv,
	user: SessionUser,
	messageIds: string[],
	classification: SpamClassification,
	accessFor: (mailboxId: string) => MailboxAccessLevel | null | undefined | Promise<MailboxAccessLevel | null | undefined>,
): Promise<string[]> {
	const db = getDb(env);
	const status = classification === "spam" ? "spam" : "received";
	const applied: string[] = [];
	let pending: Array<PromiseLike<unknown>> = [];
	let pendingAudits: AuditLogInput[] = [];
	const flush = async () => {
		if (pending.length) await db.batch(pending as never);
		if (pendingAudits.length) await createAuditLogs(env, pendingAudits);
		pending = [];
		pendingAudits = [];
	};

	for (const ids of chunk([...new Set(messageIds)], FEEDBACK_ID_BATCH)) {
		const [rows, previousRows] = await Promise.all([
			db.select({ id: messages.id, mailboxId: messages.mailboxId, direction: messages.direction }).from(messages).where(inArray(messages.id, ids)),
			db.select({ messageId: spamFeedback.messageId, classification: spamFeedback.classification, trainingTokens: spamFeedback.trainingTokens, reputationKeys: spamFeedback.reputationKeys })
				.from(spamFeedback)
				.where(inArray(spamFeedback.messageId, ids)),
		]);
		const manageable = new Map<string, boolean>();
		for (const mailboxId of new Set(rows.flatMap((row) => row.mailboxId ? [row.mailboxId] : []))) {
			manageable.set(mailboxId, !!(await accessFor(mailboxId))?.canManage);
		}
		const previousById = new Map(previousRows.map((row) => [row.messageId, row]));
		const plan = planSpamFeedback(rows, previousById, classification, (mailboxId) => manageable.get(mailboxId) ?? false);

		// Already classified this way: only the move, one statement for the chunk.
		if (plan.moveOnly.length) await db.update(messages).set({ status, folderId: null }).where(inArray(messages.id, plan.moveOnly));
		applied.push(...plan.moveOnly);

		const untrained = plan.train.filter((item) => !previousById.has(item.id)).map((item) => item.id);
		const contentById = new Map<string, ContentRow>();
		if (untrained.length) {
			for (const row of await db.select(contentColumns).from(messages).where(inArray(messages.id, untrained))) contentById.set(row.id, row);
		}
		const now = new Date();
		for (const item of plan.train) {
			const previous = previousById.get(item.id);
			const content = contentById.get(item.id);
			// Retraining reverses exactly what was stored, so the stored tokens are reused.
			const training: Training | null = previous
				? { tokens: JSON.parse(previous.trainingTokens) as string[], keys: JSON.parse(previous.reputationKeys) as ReputationKey[] }
				: content ? trainingFor(content) : null;
			if (!training) continue;
			pending.push(...feedbackStatements(db, { messageId: item.id, mailboxId: item.mailboxId, ...training, previous: previous?.classification ?? null }, classification, user.id, now));
			pendingAudits.push({ actorUserId: user.id, mailboxId: item.mailboxId, messageId: item.id, action: "email.spam_feedback", metadata: { classification } });
			applied.push(item.id);
			if (pending.length >= FEEDBACK_STATEMENT_BATCH) await flush();
		}
		await flush();
	}
	return applied;
}

export async function applySpamFeedback(env: CloudflareEnv, user: SessionUser, messageId: string, classification: SpamClassification, access?: MailboxAccessLevel | null): Promise<boolean> {
	const applied = await applySpamFeedbackToMessages(env, user, [messageId], classification, (mailboxId) => (
		access === undefined ? getMailboxAccessLevel(getDb(env), user, mailboxId) : access
	));
	return applied.length > 0;
}
