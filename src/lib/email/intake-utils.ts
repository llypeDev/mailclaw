import type { ProviderVerdicts } from "@/lib/spam/types";

/**
 * What the receiving side vouched for (sender IP, SPF/DKIM/DMARC verdicts), kept in the raw
 * object's customMetadata so a message re-enqueued after a restart (server/runtime/inbound-recovery.ts)
 * is spam-scored with the same signals as the original queue message. Values are strings because
 * R2 and S3 metadata are; keys are lower-case because S3 metadata headers come back lower-cased.
 * Kept small: S3 allows 2 KB of user metadata per object, shared with `from` and `to`.
 */
const VERDICT_KEYS = ["spf", "dkim", "dmarc", "spam", "virus"] as const;
const MAX_VERDICT_LENGTH = 32;
const MAX_IP_LENGTH = 45;
const VERDICT_PATTERN = /^[A-Za-z0-9_.-]+$/;
const IP_PATTERN = /^[0-9A-Fa-f:.]+$/;

export const INBOUND_VERDICTS_METADATA = "verdicts";
export const INBOUND_SENDER_IP_METADATA = "sender-ip";

function cleanVerdicts(value: unknown): ProviderVerdicts | undefined {
	if (!value || typeof value !== "object") return undefined;
	const verdicts: ProviderVerdicts = {};
	for (const key of VERDICT_KEYS) {
		const verdict = (value as Record<string, unknown>)[key];
		if (typeof verdict === "string" && verdict.length <= MAX_VERDICT_LENGTH && VERDICT_PATTERN.test(verdict)) verdicts[key] = verdict;
	}
	return Object.keys(verdicts).length ? verdicts : undefined;
}

function cleanSenderIp(value: unknown): string | undefined {
	return typeof value === "string" && value.length <= MAX_IP_LENGTH && IP_PATTERN.test(value) ? value : undefined;
}

/** Metadata entries for the raw object; values that are missing or malformed are left out. */
export function inboundTraceMetadata(input: { verdicts?: ProviderVerdicts; senderIp?: string }): Record<string, string> {
	const metadata: Record<string, string> = {};
	const verdicts = cleanVerdicts(input.verdicts);
	if (verdicts) metadata[INBOUND_VERDICTS_METADATA] = JSON.stringify(verdicts);
	const senderIp = cleanSenderIp(input.senderIp);
	if (senderIp) metadata[INBOUND_SENDER_IP_METADATA] = senderIp;
	return metadata;
}

/** Reads back what `inboundTraceMetadata` wrote; anything unreadable is dropped, never thrown. */
export function readInboundTraceMetadata(metadata: Record<string, string> | undefined): { verdicts?: ProviderVerdicts; senderIp?: string } {
	if (!metadata) return {};
	let verdicts: ProviderVerdicts | undefined;
	const encoded = metadata[INBOUND_VERDICTS_METADATA];
	if (encoded) {
		try {
			verdicts = cleanVerdicts(JSON.parse(encoded));
		} catch {
			verdicts = undefined;
		}
	}
	const senderIp = cleanSenderIp(metadata[INBOUND_SENDER_IP_METADATA]);
	return { ...(verdicts ? { verdicts } : {}), ...(senderIp ? { senderIp } : {}) };
}
