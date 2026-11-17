import { cn } from "@/lib/utils";
import { hasMeaningfulHtml, htmlToPlainText, joinQuotedHtml } from "./rich-text-utils";
import { isValidRecipient, recipientsToHeader } from "./recipient-utils";
import { isPastSchedule } from "./schedule-send-utils";
import type { ComposeAttachmentPolicy } from "./attachment-policy-types";
import type {
	ComposeAttachmentBlocker,
	ComposeDraftFields,
	ComposeFormMode,
	ComposeSendBlocker,
	ComposeTitleKey,
} from "./compose-form-types";

/** A message can carry at most this many attachments, stored and new together. */
export const MAX_COMPOSE_ATTACHMENTS = 10;

/** Autosave waits this long after the last edit. */
export const DRAFT_AUTOSAVE_DELAY_MS = 900;

/** The JSON body of a draft create or update. */
export function buildDraftPayload(fields: ComposeDraftFields) {
	const fullHtml = joinQuotedHtml(fields.html, fields.quotedHtml);
	return {
		mailboxId: fields.mailboxId,
		from: fields.from,
		to: recipientsToHeader(fields.to),
		cc: recipientsToHeader(fields.cc),
		bcc: recipientsToHeader(fields.bcc),
		subject: fields.subject,
		html: fullHtml,
		text: htmlToPlainText(fullHtml),
		inReplyTo: fields.threading?.inReplyTo ?? null,
		references: fields.threading?.references ?? null,
		threadId: fields.threading?.threadId ?? null,
	};
}

/** Whether there is anything worth saving: a body holding only the mailbox signature does not count. */
export function hasDraftContent(fields: ComposeDraftFields, attachmentCount: number, signature: string | null | undefined): boolean {
	const bodyContent = htmlToPlainText(fields.html).trim();
	const signatureOnly = bodyContent === (signature?.trim() ?? "");
	return Boolean(
		fields.to.length > 0 ||
		fields.cc.length > 0 ||
		fields.bcc.length > 0 ||
		fields.subject.trim() ||
		fields.quotedHtml ||
		attachmentCount > 0 ||
		(bodyContent && !signatureOnly),
	);
}

/** The first reason the message cannot be sent, or null when it can. */
export function findSendBlocker({
	to,
	cc,
	bcc,
	html,
	quotedHtml,
	scheduledAt,
}: Pick<ComposeDraftFields, "to" | "cc" | "bcc" | "html" | "quotedHtml"> & { scheduledAt: Date | null }): ComposeSendBlocker | null {
	if (to.length === 0) return { key: "compose.error.noRecipient" };
	const invalid = [...to, ...cc, ...bcc].find((entry) => !isValidRecipient(entry));
	if (invalid) return { key: "compose.error.invalidAddress", vars: { address: invalid } };
	if (!hasMeaningfulHtml(html) && !quotedHtml) return { key: "compose.error.emptyBody" };
	if (scheduledAt && isPastSchedule(scheduledAt)) return { key: "schedule.pastTime" };
	return null;
}

/** Checks the attachment count and size limits before adding `next` to what the message already holds. */
export function findAttachmentBlocker({
	storedSizes,
	pendingSizes,
	nextSizes,
	policy,
}: {
	storedSizes: number[];
	pendingSizes: number[];
	nextSizes: number[];
	policy: ComposeAttachmentPolicy;
}): ComposeAttachmentBlocker | null {
	const maxBytes = policy.maxMb * 1_000_000;
	const sum = (sizes: number[]) => sizes.reduce((total, size) => total + size, 0);
	if (storedSizes.length + pendingSizes.length + nextSizes.length > MAX_COMPOSE_ATTACHMENTS) return { key: "compose.error.maxAttachments" };
	if (nextSizes.some((size) => size > maxBytes)) return { key: "compose.error.attachmentSize", vars: { max: policy.maxMb } };
	if (sum(storedSizes) + sum(pendingSizes) + sum(nextSizes) > maxBytes) return { key: "compose.error.totalSize", vars: { max: policy.maxMb } };
	return null;
}

export function isForwardSubject(subject: string): boolean {
	return /^fwd?:/i.test(subject);
}

export function composeTitleKey({
	loadingDraft,
	isReply,
	subject,
	saved,
}: {
	loadingDraft: boolean;
	isReply: boolean;
	subject: string;
	saved: boolean;
}): ComposeTitleKey {
	if (loadingDraft) return "compose.title.loading";
	if (isReply) return "compose.title.reply";
	if (isForwardSubject(subject)) return "compose.title.forward";
	return saved ? "compose.title.saved" : "compose.title.new";
}

// Below md the popup is a bottom sheet: full width, anchored to the visual viewport (so the keyboard never covers the toolbar) and padded by the bottom safe area.
const SHEET_CLASS = "compose-sheet max-md:inset-x-0 max-md:bottom-[var(--sheet-bottom,0px)] max-md:left-0 max-md:right-0 max-md:top-auto max-md:z-50 max-md:h-[var(--sheet-height,100dvh)] max-md:w-full max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-none max-md:border-0 max-md:pt-[env(safe-area-inset-top)] max-md:pb-[var(--sheet-pad,max(env(safe-area-inset-bottom),1rem))]";

export function composeFrameClass(mode: ComposeFormMode, minimized: boolean, modalMode: boolean): string {
	if (mode !== "popup") return "relative flex h-full min-h-[720px] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm";
	if (minimized) return cn("fixed bottom-0 right-8 z-40 flex h-9 w-[min(260px,calc(100vw-32px))] flex-col overflow-hidden rounded-t-lg border border-neutral-200 bg-white shadow-2xl", SHEET_CLASS);
	if (modalMode) return cn("fixed left-1/2 top-1/2 z-50 flex h-[86vh] w-[min(860px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg bg-white shadow-2xl", SHEET_CLASS);
	return cn("fixed bottom-0 right-8 z-40 flex h-[min(520px,calc(100vh-88px))] w-[min(560px,calc(100vw-32px))] flex-col overflow-hidden rounded-t-lg border border-neutral-200 bg-white shadow-2xl", SHEET_CLASS);
}
