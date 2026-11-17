import { inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { messages } from "@/db/schema";
import type { InboundQueueMessage } from "@/lib/email/inbound";
import { readInboundTraceMetadata } from "@/lib/email/intake-utils";
import { parseHeaders, UNTRUSTED_HEADERS } from "./smtp-utils";

const PREFIX = "inbound/";
/** Older raw mail is left to the orphan sweeper (src/lib/email/raw-sweeper.ts), which deletes it after 30 days. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const PAGE = 1000;
const MAX_PAGES = 50;
const MAX_REQUEUED = 1000;
/** D1 allows 100 bound parameters per statement; the same limit keeps every dialect happy. */
const LOOKUP_BATCH = 50;
const HEADER_BYTES = 256 * 1024;

/**
 * The Node queues are in memory: intake writes raw MIME to the bucket and then
 * enqueues it, so a restart between the two steps, or before the consumer ran,
 * leaves the message stored but never delivered. On start, re-enqueue recent raw
 * objects no message refers to. The consumer dedupes by `(mailboxId, rawR2Key)`,
 * so an object that was in fact delivered is skipped, and one that resolves to
 * no mailbox is deleted there.
 *
 * Headers are re-read from the raw message (minus those only the receiving side
 * may vouch for). The SPF/DKIM/DMARC verdicts and sender IP come back from the
 * object's customMetadata, where intake stored them (src/lib/email/intake-utils.ts);
 * objects written before that carry none, so their spam scoring has no
 * authentication signals.
 *
 * Bounded: at most MAX_PAGES listing pages and MAX_REQUEUED messages per start.
 */
export async function requeueUnprocessedInbound(env: CloudflareEnv, now = Date.now()): Promise<number> {
	const db = getDb(env);
	let requeued = 0;
	let cursor: string | undefined;
	for (let page = 0; page < MAX_PAGES && requeued < MAX_REQUEUED; page += 1) {
		const listing = await env.BUCKET.list({ prefix: PREFIX, cursor, limit: PAGE });
		const recent = listing.objects.filter((object) => now - object.uploaded.getTime() <= MAX_AGE_MS).map((object) => object.key);
		for (let index = 0; index < recent.length && requeued < MAX_REQUEUED; index += LOOKUP_BATCH) {
			const batch = recent.slice(index, index + LOOKUP_BATCH);
			const referenced = await db.select({ key: messages.rawR2Key }).from(messages).where(inArray(messages.rawR2Key, batch));
			const stored = new Set(referenced.map((row) => row.key));
			for (const key of batch) {
				if (stored.has(key) || requeued >= MAX_REQUEUED) continue;
				const payload = await recoverPayload(env, key);
				if (!payload) continue;
				await env.INBOUND_QUEUE.send(payload);
				requeued += 1;
			}
		}
		if (!listing.truncated || !listing.cursor) break;
		cursor = listing.cursor;
	}
	return requeued;
}

export async function recoverPayload(env: CloudflareEnv, key: string): Promise<InboundQueueMessage | null> {
	const object = await env.BUCKET.get(key, { range: { offset: 0, length: HEADER_BYTES } });
	const from = object?.customMetadata?.from;
	const to = object?.customMetadata?.to;
	// Without the envelope recipient there is no way to route it; the sweeper removes it later.
	if (!object || !to) return null;
	const headers = parseHeaders(Buffer.from(await object.arrayBuffer()));
	for (const name of UNTRUSTED_HEADERS) delete headers[name];
	const { verdicts, senderIp } = readInboundTraceMetadata(object.customMetadata);
	return { from: from ?? "", to, rawR2Key: key, headers, ...(verdicts ? { verdicts } : {}), ...(senderIp ? { senderIp } : {}) };
}
