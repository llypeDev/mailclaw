import { inArray } from "drizzle-orm";
import type { AppDatabase } from "@/db";
import { messageAttachments, messages } from "@/db/schema";
import { deleteUnreferencedObjects } from "@/lib/drive/shared-objects";
import { chunk } from "@/lib/email/attachment-storage-utils";
import { MESSAGE_DELETE_BATCH } from "./message-cleanup-utils";

type MessageWithObjects = { id: string; rawR2Key: string | null };

/** Remove every external object owned by a message before deleting its row. */
export async function deleteMessageWithObjects(
	env: CloudflareEnv,
	db: AppDatabase,
	id: string,
	rawR2Key: string | null,
): Promise<void> {
	await deleteMessagesWithObjects(env, db, [{ id, rawR2Key }]);
}

/**
 * `deleteMessageWithObjects` for many messages: per batch one attachment lookup, one bucket delete
 * per kind of object and one row delete, instead of three queries and an object delete per message.
 * Objects go first, so a failure leaves rows that a retry still finds.
 */
export async function deleteMessagesWithObjects(
	env: CloudflareEnv,
	db: AppDatabase,
	rows: MessageWithObjects[],
): Promise<void> {
	for (const batch of chunk(rows, MESSAGE_DELETE_BATCH)) {
		const ids = batch.map((row) => row.id);
		const attachments = await db
			.select({ id: messageAttachments.id, r2Key: messageAttachments.r2Key })
			.from(messageAttachments)
			.where(inArray(messageAttachments.messageId, ids));
		// A Drive item saved from one of these attachments keeps its object alive.
		await deleteUnreferencedObjects(env, db, attachments.map((row) => row.r2Key), { attachmentIds: attachments.map((row) => row.id) });
		const rawKeys = Array.from(new Set(batch.map((row) => row.rawR2Key).filter((key): key is string => !!key)));
		if (rawKeys.length) await env.BUCKET.delete(rawKeys);
		await db.delete(messages).where(inArray(messages.id, ids));
	}
}
