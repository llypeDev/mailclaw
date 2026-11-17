import { useEffect, useMemo, useState } from "react";
import type { MailboxOption } from "@/components/mailbox-provider";
import { formatEmailAddress } from "@/lib/email/address";
import type { ComposeSenderOption } from "./compose-form-types";

function mailboxAddresses(mailbox: MailboxOption): string[] {
	return mailbox.senderAddresses?.length ? mailbox.senderAddresses : [`${mailbox.localPart}@${mailbox.hostname}`];
}

/** The From address: which mailbox and which of its addresses the message is sent as. */
export function useComposeSender({
	selectedMailbox,
	setSelectedMailbox,
	mailboxes,
	loadedDraftFrom,
}: {
	selectedMailbox: MailboxOption | null;
	setSelectedMailbox: (mailbox: MailboxOption | null) => void;
	mailboxes: MailboxOption[];
	/** The sender of a loaded draft, lowercased; it wins over the mailbox's first address. */
	loadedDraftFrom: string | null;
}) {
	const [selectedFrom, setSelectedFrom] = useState("");

	useEffect(() => {
		if (!selectedMailbox && mailboxes.length === 1) setSelectedMailbox(mailboxes[0]);
	}, [mailboxes, selectedMailbox, setSelectedMailbox]);

	const senderAddresses = useMemo(() => (selectedMailbox ? mailboxAddresses(selectedMailbox) : []), [selectedMailbox]);
	const senderOptions = useMemo<ComposeSenderOption[]>(
		() => mailboxes.flatMap((mailbox) => mailboxAddresses(mailbox).map((address) => ({ mailbox, address }))),
		[mailboxes],
	);
	// Keep the sender on an address the mailbox can send as. A loaded draft's
	// sender wins whenever it or the mailbox's addresses change.
	const [prevSenderSync, setPrevSenderSync] = useState({ loadedDraftFrom, senderAddresses });
	let nextFrom = selectedFrom;
	if (loadedDraftFrom !== prevSenderSync.loadedDraftFrom || senderAddresses !== prevSenderSync.senderAddresses) {
		setPrevSenderSync({ loadedDraftFrom, senderAddresses });
		if (loadedDraftFrom && senderAddresses.includes(loadedDraftFrom)) nextFrom = loadedDraftFrom;
	}
	if (!senderAddresses.length) nextFrom = "";
	else if (!senderAddresses.includes(nextFrom)) nextFrom = senderAddresses[0];
	if (nextFrom !== selectedFrom) setSelectedFrom(nextFrom);
	const fromAddr = selectedMailbox && selectedFrom
		? formatEmailAddress(selectedFrom, selectedMailbox.displayName)
		: "";

	/** `value` is `mailboxId|address`, as the From select lists them. */
	function selectSender(value: string) {
		const option = senderOptions.find((item) => `${item.mailbox.id}|${item.address}` === value);
		if (!option) return;
		setSelectedFrom(option.address);
		if (selectedMailbox?.id !== option.mailbox.id) setSelectedMailbox(option.mailbox);
	}

	return { selectedFrom, senderOptions, fromAddr, selectSender };
}
