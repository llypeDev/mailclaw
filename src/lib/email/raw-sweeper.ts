import { inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { messages } from "@/db/schema";
import { sweepRawObjects } from "./raw-sweeper-utils";

/**
 * Deletes raw MIME under `inbound/` that no stored message refers to and that is old enough
 * that no copy of its queue message can still be retried or waiting in the dead-letter queue
 * (see RAW_SWEEP_MIN_AGE_MS). This catches what the early-return cleanup in
 * `processInboundMessage` cannot: messages dropped after their final failed retry and
 * mail accepted for addresses that never resolved to a mailbox.
 *
 * Each run walks a bounded number of listing pages and keeps its cursor in the bucket, so
 * successive runs cover the whole prefix instead of re-reading its first pages forever.
 */
export async function sweepOrphanedRawMail(env: CloudflareEnv, now = new Date()): Promise<number> {
	const db = getDb(env);
	const result = await sweepRawObjects(env.BUCKET, now, async (keys) => {
		const referenced = await db.select({ key: messages.rawR2Key }).from(messages).where(inArray(messages.rawR2Key, keys));
		return referenced.map((row) => row.key).filter((key): key is string => typeof key === "string");
	});
	return result.removed;
}
