import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { messageAttachments, messages } from "@/db/schema";
import { getMailboxAccessLevel } from "@/lib/mailboxes/access";
import type { SessionUser } from "@/lib/auth/types";

/**
 * The attachment row the user may read, without touching the bucket: the same
 * access rules as `getAttachmentForUser`, so the route can decide between a
 * risk answer, a `head()` for a 304 and a (ranged) `get()` itself.
 */
export async function findReadableAttachment(env: CloudflareEnv, user: SessionUser, messageId: string, attachmentId: string) {
	const db = getDb(env);
	const [message] = await db
		.select({ mailboxId: messages.mailboxId, userId: messages.userId })
		.from(messages)
		.where(eq(messages.id, messageId))
		.limit(1);
	if (!message) return null;

	if (message.mailboxId) {
		const access = await getMailboxAccessLevel(db, user, message.mailboxId);
		if (!access?.canRead) return null;
	} else if (message.userId !== user.id) {
		return null;
	}

	const [attachment] = await db
		.select()
		.from(messageAttachments)
		.where(
			and(
				eq(messageAttachments.id, attachmentId),
				eq(messageAttachments.messageId, messageId),
				isNull(messageAttachments.trashedAt),
			),
		)
		.limit(1);
	return attachment ?? null;
}
