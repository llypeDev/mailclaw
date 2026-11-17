/**
 * Helpers for the HTML composer. The editor owns one HTML string; the plain-text
 * alternative and the draft/send payloads are all derived from it, so there is
 * a single source of truth for what the message says.
 *
 * The sanitizer-free helpers live in `rich-text-core-utils.ts` and are
 * re-exported here; code on the message-list path imports them from there so it
 * does not pull in the sanitizer this module needs for signatures.
 */

import { sanitizeEmailHtml } from "@/app/(dashboard)/inbox/[messageId]/email-html-sanitizer";
import { isHtmlSignature, textToHtml } from "./rich-text-core-utils";

export {
	QUOTE_ATTRIBUTE,
	escapeHtml,
	hasMeaningfulHtml,
	htmlToPlainText,
	isHtmlSignature,
	joinQuotedHtml,
	splitQuotedHtml,
	textToHtml,
	wrapQuotedHtml,
} from "./rich-text-core-utils";

const SIGNATURE_ATTRIBUTE = "data-mailclaw-signature";

export function signatureToHtml(signature: string | null | undefined): string {
	const value = signature?.trim() ?? "";
	if (!value) return "";
	if (isHtmlSignature(value) && typeof DOMParser !== "undefined") {
		return sanitizeEmailHtml(value, { forOutgoing: true }) ?? "";
	}
	return textToHtml(value).replace(/^<div>|<\/div>$/g, "");
}

function signatureBlock(signature: string | null | undefined): string {
	const html = signatureToHtml(signature);
	return html ? `<div ${SIGNATURE_ATTRIBUTE}="1"><br><br>${html}</div>` : "";
}

/** Swap or append the mailbox signature, mirroring the plain-text behaviour. */
export function applyMailboxSignatureHtml(
	html: string,
	previousSignature: string | null | undefined,
	nextSignature: string | null | undefined,
): string {
	const previousBlock = signatureBlock(previousSignature);
	const nextBlock = signatureBlock(nextSignature);
	if (previousBlock && html.includes(previousBlock)) return html.replace(previousBlock, nextBlock);
	if (!nextBlock || html.includes(nextBlock)) return html;
	return `${html}${nextBlock}`;
}
