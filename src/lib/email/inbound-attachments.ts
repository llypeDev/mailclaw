import {
	MAX_ATTACHMENT_COUNT,
	MAX_ATTACHMENT_SIZE,
	MAX_TOTAL_ATTACHMENT_SIZE,
} from "@/lib/email/attachments";
import { MimeLimitError, parseRawMime } from "@/lib/email/parse";
import { scanMimeAttachments } from "@/lib/email/mime-preflight";
import type { AttachmentContent } from "@/lib/email/attachment-types";

function tooManyAttachmentsReason(): string {
	return `Message rejected: more than ${MAX_ATTACHMENT_COUNT} attachments. Send fewer files or a download link.`;
}

export function inboundAttachmentLimitReason(attachments: AttachmentContent[]): string | null {
	if (attachments.length > MAX_ATTACHMENT_COUNT) return tooManyAttachmentsReason();
	let totalSize = 0;
	for (const attachment of attachments) {
		const size = attachment.content.byteLength;
		if (size > MAX_ATTACHMENT_SIZE) {
			return "Message rejected: an attachment exceeds 25 MB. Send a download link instead.";
		}
		totalSize += size;
		if (totalSize > MAX_TOTAL_ATTACHMENT_SIZE) {
			return "Message rejected: attachments exceed 25 MB in total. Send a download link instead.";
		}
	}
	return null;
}

/**
 * The receiving-time check for runtimes that pay for CPU per message (the Worker `email`
 * handler): one linear pass over the raw bytes, no decoding. It enforces the MIME preflight
 * limits and the attachment count; byte sizes are already bounded by the 25 MiB raw limit
 * (base64 decodes to at most ~19 MB). The queue consumer parses the message once and applies
 * `inboundAttachmentLimitReason` as the authoritative check, dropping whatever this lets through.
 */
export function inboundAttachmentLimitReasonFromScan(raw: ArrayBuffer): string | null {
	const scan = scanMimeAttachments(raw, MAX_ATTACHMENT_COUNT);
	if (scan.reason) return scan.reason;
	if (scan.attachments > MAX_ATTACHMENT_COUNT) return tooManyAttachmentsReason();
	return null;
}

export async function inboundAttachmentLimitReasonFromRaw(raw: ArrayBuffer): Promise<string | null> {
	try {
		const parsed = await parseRawMime(raw);
		return inboundAttachmentLimitReason(parsed.attachments);
	} catch (error) {
		if (error instanceof MimeLimitError) return error.message;
		console.warn("Inbound MIME parse failed", error);
		return "Message rejected: the message could not be parsed.";
	}
}
