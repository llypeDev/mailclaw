import type { AppDatabase } from "@/db";
import { chunk } from "@/lib/email/attachment-storage-utils";
import { deleteMessagesWithObjects } from "@/lib/email/message-cleanup";
import { MESSAGE_DELETE_BATCH } from "@/lib/email/message-cleanup-utils";
import { createAuditLogs } from "@/lib/mailboxes/audit";

type DeletableMessage = {
	id: string;
	mailboxId: string | null;
	rawR2Key: string | null;
	status: string;
};

/**
 * Permanently remove messages (row, raw MIME and attachment objects) and audit
 * each one. The audit row cannot point at the deleted message, since its
 * `message_id` is a foreign key, so the id travels in the metadata instead.
 * Works in batches, and a batch is audited as soon as it is gone.
 */
export async function permanentlyDeleteMessages(
	env: CloudflareEnv,
	db: AppDatabase,
	actorUserId: string,
	rows: DeletableMessage[],
	source: "bulk" | "empty" | "retention",
): Promise<number> {
	for (const batch of chunk(rows, MESSAGE_DELETE_BATCH)) {
		await deleteMessagesWithObjects(env, db, batch);
		await createAuditLogs(env, batch.map((row) => ({
			actorUserId,
			mailboxId: row.mailboxId,
			action: "email.delete",
			metadata: { permanent: true, source, messageId: row.id, previousStatus: row.status },
		})));
	}
	return rows.length;
}
