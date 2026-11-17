import type { RoutingDecision } from "@/lib/email/routing";
import { parseRecipientAddress } from "@/lib/email/recipient-address";

/**
 * The mailbox the receiving side (Worker `email` handler or `intakeIncomingMail`) decided to
 * store a message in, carried on the inbound queue message so the consumer does not resolve
 * the address again. Only "store in this mailbox" outcomes are carried: every other decision
 * either never reaches the queue or is rare enough that the consumer resolves it itself.
 */
export type InboundRoute = {
	mailboxId: string;
	userId: string;
	localPart: string;
	/** The recipient's domain, the one the address was resolved under (aliases included). */
	hostname: string;
};

/** What the consumer reads back from the database to confirm a carried route is still current. */
export type InboundRouteState = {
	mailbox: { userId: string; localPart: string; disabled: boolean } | null | undefined;
	recipientDomainStatus: string | null | undefined;
};

const MAX_FIELD_LENGTH = 320;

/**
 * The route to carry for a receiving-side decision, or undefined when the consumer must resolve
 * on its own. A forward that keeps a copy stores in its mailbox, which the consumer (resolving
 * without mailbox forwards) would also pick. A forward without a copy reaches the queue only when
 * the forward failed; the consumer has always decided that case itself, so it still does.
 */
export function inboundRouteFromDecision(decision: RoutingDecision | null | undefined): InboundRoute | undefined {
	const mailbox = decision?.mailbox;
	if (!mailbox) return undefined;
	if (decision.action !== "store" && !(decision.action === "forward" && decision.keepCopy)) return undefined;
	return {
		mailboxId: mailbox.mailboxId,
		userId: mailbox.userId,
		localPart: mailbox.localPart,
		hostname: mailbox.hostname,
	};
}

/** Shape check for a route read off the queue; anything malformed is ignored, never trusted. */
export function parseInboundRoute(value: unknown): InboundRoute | null {
	if (typeof value !== "object" || value === null) return null;
	const route = value as Record<string, unknown>;
	const fields = [route.mailboxId, route.userId, route.localPart, route.hostname];
	if (!fields.every((field) => typeof field === "string" && field.length > 0 && field.length <= MAX_FIELD_LENGTH)) return null;
	return {
		mailboxId: route.mailboxId as string,
		userId: route.userId as string,
		localPart: route.localPart as string,
		hostname: route.hostname as string,
	};
}

/**
 * Whether a carried route still holds: the envelope recipient is on the route's domain and that
 * domain is still active, and the mailbox still exists, is enabled, belongs to the same user and
 * kept its address. Anything else (a mailbox deleted, disabled, renamed or moved between enqueue
 * and processing) sends the consumer back to a full resolve.
 */
export function isInboundRouteCurrent(route: InboundRoute, recipient: string, state: InboundRouteState): boolean {
	const domain = parseRecipientAddress(recipient)?.domain?.toLowerCase();
	if (!domain || domain !== route.hostname.toLowerCase()) return false;
	if (state.recipientDomainStatus !== "active") return false;
	const mailbox = state.mailbox;
	if (!mailbox || mailbox.disabled) return false;
	return mailbox.userId === route.userId && mailbox.localPart === route.localPart;
}
