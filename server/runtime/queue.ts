/**
 * The Queue producer API with an in-process consumer. Delivery order and the
 * retry policy match the Workers consumers (src/lib/queues/retry-utils.ts:
 * QUEUE_MAX_RETRIES per queue, backing off 10 s, 30 s, 90 s ... up to 15 min).
 * There is no dead-letter queue here; a job that exhausts its retries is logged.
 * Jobs live in memory: inbound mail is already on disk before it is enqueued, so a restart at worst leaves a message unprocessed in the blob
 * store, never lost (server/runtime/inbound-recovery.ts re-enqueues it).
 *
 * At most `concurrency` jobs run at once; the rest wait in arrival order. An
 * inbound job holds the whole raw MIME (up to the SMTP size limit), so a burst
 * must not start every job together.
 */
import { QUEUE_MAX_RETRIES, queueRetryDelaySeconds, type QueueKind } from "@/lib/queues/retry-utils";

export type QueueConsumer = (body: unknown) => Promise<void>;

/** `attempts` counts earlier failed deliveries, so delivery number `attempts + 1` is running. */
type Pending = { body: unknown; attempts: number };

export class InProcessQueue {
	private consumer: QueueConsumer | null = null;
	private readonly maxRetries: number;
	private readonly retryDelayMs: ((failedDelivery: number) => number);
	private readonly concurrency: number;
	private readonly timers = new Set<ReturnType<typeof setTimeout>>();
	private readonly ready: Pending[] = [];
	private running = 0;
	private stopped = false;

	constructor(readonly name: string, options?: { kind?: QueueKind; maxRetries?: number; concurrency?: number; retryDelayMs?: number }) {
		this.maxRetries = options?.maxRetries ?? QUEUE_MAX_RETRIES[options?.kind ?? "outbound"];
		const fixedDelay = options?.retryDelayMs;
		this.retryDelayMs = fixedDelay !== undefined ? () => fixedDelay : (failedDelivery) => queueRetryDelaySeconds(failedDelivery) * 1000;
		this.concurrency = Math.max(1, Math.floor(options?.concurrency ?? 4));
	}

	setConsumer(consumer: QueueConsumer) {
		this.consumer = consumer;
		this.pump();
	}

	async send(body: unknown, options?: { delaySeconds?: number }) {
		this.schedule({ body, attempts: 0 }, (options?.delaySeconds ?? 0) * 1000);
	}

	async sendBatch(messages: Iterable<{ body: unknown; delaySeconds?: number }>) {
		for (const message of messages) await this.send(message.body, { delaySeconds: message.delaySeconds });
	}

	async metrics() {
		return { backlogCount: this.timers.size + this.ready.length + this.running };
	}

	/** Jobs currently being consumed; exposed for tests and diagnostics. */
	get active() {
		return this.running;
	}

	private schedule(pending: Pending, delayMs: number) {
		if (this.stopped) return;
		const timer = setTimeout(() => {
			this.timers.delete(timer);
			this.ready.push(pending);
			this.pump();
		}, delayMs);
		this.timers.add(timer);
	}

	/** Start waiting jobs while there is a free slot and a consumer to run them. */
	private pump() {
		while (!this.stopped && this.consumer && this.running < this.concurrency && this.ready.length) {
			const pending = this.ready.shift()!;
			this.running += 1;
			void this.deliver(this.consumer, pending).finally(() => {
				this.running -= 1;
				this.pump();
			});
		}
	}

	private async deliver(consumer: QueueConsumer, pending: Pending) {
		try {
			await consumer(pending.body);
		} catch (error) {
			console.error(`Queue ${this.name}: job failed`, error);
			// queueRetryDelaySeconds takes the 1-based number of the delivery that failed, like Workers' msg.attempts.
			if (pending.attempts < this.maxRetries) this.schedule({ body: pending.body, attempts: pending.attempts + 1 }, this.retryDelayMs(pending.attempts + 1));
			else console.error(`Queue ${this.name}: giving up after ${this.maxRetries} retries`, pending.body);
		}
	}

	stop() {
		this.stopped = true;
		for (const timer of this.timers) clearTimeout(timer);
		this.timers.clear();
		this.ready.length = 0;
	}
}

export function openQueue<T>(name: string, options?: { kind?: QueueKind; concurrency?: number }): Queue<T> & InProcessQueue {
	return new InProcessQueue(name, options) as unknown as Queue<T> & InProcessQueue;
}
