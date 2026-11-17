/**
 * Retry policy shared by the Worker queue consumer (worker.ts) and checked against the consumer
 * settings in wrangler.jsonc by tests/queue-retry-policy.test.mjs, so the two cannot drift apart.
 *
 * Every retry costs one Queues operation (a read), and Workers Free allows 10,000 a day, so the
 * budget is spent on outlasting short outages (D1, R2 or a mail provider down for minutes)
 * rather than on many quick retries that all fail the same way.
 */

export type QueueKind = "inbound" | "outbound" | "agent";

/**
 * `max_retries` per consumer. A message is delivered up to `max_retries + 1` times; after the last
 * failure the inbound and outbound queues move it to their dead-letter queue.
 */
export const QUEUE_MAX_RETRIES: Record<QueueKind, number> = {
	inbound: 5,
	outbound: 5,
	// Agent drafts are model calls: each retry costs tokens as well as a queue operation.
	agent: 3,
};

/** Dead-letter queue per consumer; null means a message that exhausts its retries is dropped. */
export const QUEUE_DEAD_LETTER: Record<QueueKind, string | null> = {
	inbound: "mailclaw-inbound-dlq",
	outbound: "mailclaw-outbound-dlq",
	agent: null,
};

const BASE_DELAY_SECONDS = 10;
const BACKOFF_FACTOR = 3;
/**
 * 15 minutes. With five retries the waits are 10 s, 30 s, 1.5 min, 4.5 min and 13.5 min, about
 * 20 minutes in all: long enough to ride out a short outage, and short enough that an import
 * chunk being retried is not declared stale by `sweepImportJobs` (30 minutes idle). Queues caps
 * `delaySeconds` far above this.
 */
export const MAX_RETRY_DELAY_SECONDS = 15 * 60;

/**
 * Delay before redelivering a message that failed on delivery number `attempts` (Cloudflare's
 * `msg.attempts`, which starts at 1): 10 s, then three times longer each time, capped.
 */
export function queueRetryDelaySeconds(attempts: number): number {
	const failures = Number.isFinite(attempts) ? Math.max(Math.floor(attempts), 1) : 1;
	// The exponent is bounded so a large attempt count cannot overflow to Infinity before the cap.
	const delay = BASE_DELAY_SECONDS * BACKOFF_FACTOR ** Math.min(failures - 1, 10);
	return Math.min(delay, MAX_RETRY_DELAY_SECONDS);
}

/** True when this failure is the last one the consumer gets: the next retry goes to the dead-letter queue (or is dropped). */
export function isFinalQueueAttempt(kind: QueueKind, attempts: number): boolean {
	return attempts > QUEUE_MAX_RETRIES[kind];
}
