import { createHash } from "node:crypto";

/** Headers a sender can write but only the receiving side may vouch for. */
export const UNTRUSTED_HEADERS = ["authentication-results", "received-spf", "arc-authentication-results", "received"];

/** Header map in the shape the Worker handler provides: lower-cased names, folded lines joined. */
export function parseHeaders(raw: Buffer): Record<string, string> {
	const text = new TextDecoder("latin1").decode(raw.subarray(0, Math.min(raw.length, 256 * 1024)));
	const end = text.search(/\r?\n\r?\n/);
	const block = (end >= 0 ? text.slice(0, end) : text).replace(/\r?\n[ \t]+/g, " ");
	const headers: Record<string, string> = {};
	for (const line of block.split(/\r?\n/)) {
		const index = line.indexOf(":");
		if (index <= 0) continue;
		const name = line.slice(0, index).trim().toLowerCase();
		if (!(name in headers)) headers[name] = line.slice(index + 1).trim();
	}
	return headers;
}

/** Prepends header fields to a raw message, as `message.forward(to, headers)` does on Workers. */
export function withPrependedHeaders(raw: Buffer, headers: Record<string, string>): Buffer {
	const lines = Object.entries(headers)
		// A value must stay one header line; anything after a line break would be a header injection.
		.map(([name, value]) => `${name}: ${value.replace(/[\r\n]+/g, " ")}\r\n`)
		.join("");
	return lines ? Buffer.concat([Buffer.from(lines, "utf8"), raw]) : raw;
}

/**
 * Remembers work a DATA transaction finished for a message, so that when the
 * transaction as a whole has to be retried (451), the sender's retry of the same
 * bytes does not repeat it: recipients already stored or refused, and forwards
 * already sent. Entries expire, and the oldest are dropped past `maxEntries`.
 * In memory only; after a restart a retry repeats the work, as before.
 */
export class CompletedWork {
	private readonly entries = new Map<string, { expiresAt: number; value: string }>();

	constructor(
		private readonly ttlMs = 24 * 60 * 60 * 1000,
		private readonly maxEntries = 10_000,
		private readonly clock: () => number = Date.now,
	) {}

	/** The value recorded for `key`, or undefined when nothing (unexpired) was. */
	get(key: string): string | undefined {
		const entry = this.entries.get(key);
		if (!entry) return undefined;
		if (entry.expiresAt <= this.clock()) {
			this.entries.delete(key);
			return undefined;
		}
		return entry.value;
	}

	has(key: string): boolean {
		return this.get(key) !== undefined;
	}

	add(key: string, value = "") {
		this.entries.delete(key);
		this.entries.set(key, { expiresAt: this.clock() + this.ttlMs, value });
		while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value as string);
	}

	get size() {
		return this.entries.size;
	}
}

/** Identifies one message from one sender, independent of the connection it arrived on. */
export function messageFingerprint(raw: Buffer, envelopeFrom: string): string {
	return createHash("sha256").update(envelopeFrom.toLowerCase()).update("\0").update(raw).digest("hex");
}

export type RecipientOutcome =
	| { recipient: string; outcome: "delivered" }
	| { recipient: string; outcome: "rejected"; reason: string }
	| { recipient: string; outcome: "failed" };

export type SmtpReply = { code: 250 } | { code: 451 | 550; message: string };

/**
 * SMTP gives one answer per DATA, not one per recipient (LMTP would), so the
 * answer has to stand for all of them:
 * - any temporary failure: 451, so the sender retries; recipients that were
 *   finished are remembered and skipped on the retry;
 * - every recipient refused: 550 with the first reason;
 * - otherwise 250, even if a routing rule refused some recipients after RCPT
 *   (a rule changed in between): the others have the message, and a 550 would
 *   tell the sender nobody does.
 */
export function smtpDataReply(outcomes: RecipientOutcome[]): SmtpReply {
	if (outcomes.some((item) => item.outcome === "failed")) return { code: 451, message: "Temporary failure, try again later" };
	const rejected = outcomes.filter((item): item is Extract<RecipientOutcome, { outcome: "rejected" }> => item.outcome === "rejected");
	if (outcomes.length > 0 && rejected.length === outcomes.length) return { code: 550, message: rejected[0].reason };
	return { code: 250 };
}

/**
 * Runs `deliver` for each recipient not already finished for this message, records
 * the ones that finish (delivered or refused), and returns every recipient's outcome.
 * A recipient whose delivery throws is a temporary failure and is not recorded.
 */
export async function deliverToRecipients(
	recipients: string[],
	fingerprint: string,
	completed: CompletedWork,
	deliver: (recipient: string) => Promise<{ rejected: string | null }>,
): Promise<RecipientOutcome[]> {
	const outcomes: RecipientOutcome[] = [];
	for (const recipient of recipients) {
		const key = `rcpt:${fingerprint}:${recipient.toLowerCase()}`;
		// Recorded as "" when delivered, or the refusal reason.
		const earlier = completed.get(key);
		if (earlier !== undefined) {
			outcomes.push(earlier === "" ? { recipient, outcome: "delivered" } : { recipient, outcome: "rejected", reason: earlier });
			continue;
		}
		try {
			const result = await deliver(recipient);
			const rejected = result.rejected === null ? null : result.rejected || "Message rejected by routing rule";
			completed.add(key, rejected ?? "");
			outcomes.push(rejected === null ? { recipient, outcome: "delivered" } : { recipient, outcome: "rejected", reason: rejected });
		} catch (error) {
			console.error(`SMTP intake failed for ${recipient}`, error);
			outcomes.push({ recipient, outcome: "failed" });
		}
	}
	return outcomes;
}

/** Key for a forward of this message, made for `recipient`, to `destination`, so a retried transaction does not send it twice. */
export function forwardKey(fingerprint: string, recipient: string, destination: string): string {
	return `fwd:${fingerprint}:${recipient.toLowerCase()}:${destination.toLowerCase()}`;
}
