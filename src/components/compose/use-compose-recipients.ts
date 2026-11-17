import { useState } from "react";
import { headerToRecipients, mergeRecipients } from "./recipient-utils";

/** To, Cc and Bcc, and whether the Cc and Bcc rows are open. */
export function useComposeRecipients(initialTo: string[] | null | undefined, opensDraft: boolean) {
	// Recipients handed in by the caller (Contacts "Send email", etc.) seed a fresh composer.
	const [to, setTo] = useState<string[]>(() => (opensDraft ? [] : mergeRecipients([], initialTo ?? [])));
	const [cc, setCc] = useState<string[]>([]);
	const [bcc, setBcc] = useState<string[]>([]);
	const [showCc, setShowCc] = useState(false);
	const [showBcc, setShowBcc] = useState(false);

	/** Takes the recipients of a loaded draft; Cc and Bcc open when they hold anyone. */
	function loadFromHeaders(headers: { to: string | null | undefined; cc: string | null | undefined; bcc: string | null | undefined }) {
		setTo(headerToRecipients(headers.to));
		const draftCc = headerToRecipients(headers.cc);
		const draftBcc = headerToRecipients(headers.bcc);
		setCc(draftCc);
		setBcc(draftBcc);
		setShowCc(draftCc.length > 0);
		setShowBcc(draftBcc.length > 0);
	}

	function clear() {
		setTo([]);
		setCc([]);
		setBcc([]);
		setShowCc(false);
		setShowBcc(false);
	}

	return { to, setTo, cc, setCc, bcc, setBcc, showCc, setShowCc, showBcc, setShowBcc, loadFromHeaders, clear };
}
