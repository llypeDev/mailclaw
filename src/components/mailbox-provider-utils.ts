import { authFetch, getClientSessionToken } from "@/lib/auth/client";
import type { MailboxOption } from "./mailbox-provider";

let mailboxesCache: MailboxOption[] | null = null;
let mailboxesCacheSessionToken: string | null = null;
let mailboxesRequest: Promise<MailboxOption[]> | null = null;
let mailboxesRequestSessionToken: string | null = null;
let cacheGeneration = 0;
export const SELECTED_MAILBOX_STORAGE_KEY = "selected-mailbox-id";

/**
 * The primary mailbox is the one at the account address; it is the only mailbox
 * whose name and avatar follow the profile.
 */
export function isIdentityMailbox(mailbox: Pick<MailboxOption, "type" | "isPrimary">): boolean {
	return mailbox.type === "personal" && !!mailbox.isPrimary;
}

export function clearMailboxesCache() {
	cacheGeneration += 1;
	mailboxesCache = null;
	mailboxesCacheSessionToken = null;
	mailboxesRequest = null;
	mailboxesRequestSessionToken = null;
}

export function clearMailboxClientState() {
	clearMailboxesCache();
	if (typeof window !== "undefined") {
		localStorage.removeItem(SELECTED_MAILBOX_STORAGE_KEY);
	}
}

/** Reduces `/api/mailboxes` items (also carried by `/api/bootstrap`) to what the client keeps. */
export function toMailboxOptions(items: readonly MailboxOption[] | null | undefined): MailboxOption[] {
	return (items ?? []).map((m) => ({
		id: m.id,
		domainId: m.domainId,
		localPart: m.localPart,
		hostname: m.hostname,
		displayName: m.displayName,
		signature: m.signature,
		autoReplyEnabled: m.autoReplyEnabled,
		autoReplySubject: m.autoReplySubject,
		autoReplyBody: m.autoReplyBody,
		hasAvatar: m.hasAvatar,
		type: m.type,
		permission: m.permission,
		isPrimary: m.isPrimary,
		senderAddresses: m.senderAddresses,
	}));
}

/** Fills the cache from a list read elsewhere (the bootstrap), unless a newer request is already running. */
export function seedMailboxesCache(items: MailboxOption[]) {
	if (mailboxesRequest) return;
	mailboxesCache = items;
	mailboxesCacheSessionToken = getClientSessionToken();
}

export async function fetchMailboxOptions(force = false): Promise<MailboxOption[]> {
	const sessionToken = getClientSessionToken();
	if (!force && mailboxesCache && mailboxesCacheSessionToken === sessionToken) return mailboxesCache;
	if (!force && mailboxesRequest && mailboxesRequestSessionToken === sessionToken) return mailboxesRequest;

	const requestGeneration = cacheGeneration;
	mailboxesRequestSessionToken = sessionToken;
	mailboxesRequest = authFetch("/api/mailboxes")
		.then((res) => res.json())
		.then((data) => {
			const items = toMailboxOptions((data as { mailboxes?: MailboxOption[] }).mailboxes);
			if (requestGeneration === cacheGeneration) {
				mailboxesCache = items;
				mailboxesCacheSessionToken = sessionToken;
			}
			return items;
		})
		.finally(() => {
			if (requestGeneration === cacheGeneration) {
				mailboxesRequest = null;
				mailboxesRequestSessionToken = null;
			}
		});

	return mailboxesRequest;
}
