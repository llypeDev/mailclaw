import type { MailboxOption } from "@/components/mailbox-provider";
import type { ComposeThreading } from "./types";

export type ComposeFormMode = "page" | "popup";

export type ComposeFormProps = {
	mode?: ComposeFormMode;
	draftIdToLoad?: string | null;
	/** Recipients a fresh composer starts with, e.g. from the Contacts page. */
	initialTo?: string[] | null;
	onClose?: () => void;
};

export type ComposeToast = { type: "success" | "error"; message: string } | null;

/** One address the user can send as, and the mailbox it belongs to. */
export type ComposeSenderOption = { mailbox: MailboxOption; address: string };

/** The parts of the message an autosave (or the save before an AI review) writes to the draft. */
export type ComposeDraftFields = {
	mailboxId: string | undefined;
	from: string;
	to: string[];
	cc: string[];
	bcc: string[];
	subject: string;
	html: string;
	quotedHtml: string | null;
	threading: ComposeThreading | null;
};

/** Why the message cannot be sent yet, as a translation key plus its variables. */
export type ComposeSendBlocker =
	| { key: "compose.error.noRecipient" | "compose.error.emptyBody" | "schedule.pastTime" }
	| { key: "compose.error.invalidAddress"; vars: { address: string } };

/** Why new files cannot be attached, as a translation key plus its variables. */
export type ComposeAttachmentBlocker =
	| { key: "compose.error.maxAttachments" }
	| { key: "compose.error.attachmentSize" | "compose.error.totalSize"; vars: { max: number } };

export type ComposeTitleKey =
	| "compose.title.loading"
	| "compose.title.reply"
	| "compose.title.forward"
	| "compose.title.saved"
	| "compose.title.new";
