import { forwardedMarker, getAccountForwardingDestination, isForwardedMarkerValid, MAILCLAW_FORWARDED_HEADER } from "@/lib/email/account-forwarding";
import { resolveIncomingMail } from "@/lib/email/incoming";
import { inboundStorageKey } from "@/lib/email/inbound-id";
import type { InboundQueueMessage } from "@/lib/email/inbound";
import type { IntakeActions, IntakeInput, IntakeResult } from "@/lib/email/intake-types";
import { inboundTraceMetadata } from "@/lib/email/intake-utils";

/**
 * What the Worker `email` handler does, for runtimes that hand us the whole
 * message as bytes (an SMTP listener, or the Cloudflare relay webhook):
 * resolve domain rules, act on reject and forward through the supplied
 * callbacks, then store the raw MIME and enqueue it for parsing.
 */
export async function intakeIncomingMail(env: CloudflareEnv, input: IntakeInput, actions: IntakeActions): Promise<IntakeResult> {
	const alreadyForwarded = await isForwardedMarkerValid(env, input.headers[MAILCLAW_FORWARDED_HEADER.toLowerCase()] ?? input.headers[MAILCLAW_FORWARDED_HEADER]);
	const marker = { [MAILCLAW_FORWARDED_HEADER]: await forwardedMarker(env) };
	const decision = await resolveIncomingMail(env, input.from, input.to, {
		subject: input.headers.subject,
		alreadyForwarded,
	});

	if (decision?.action === "reject") {
		const reason = decision.rejectReason ?? "Message rejected by routing rule";
		await actions.reject?.(reason);
		return { action: "reject", reason };
	}

	let forwardedTo: string | null = null;
	const ruleForward = decision?.action === "forward" && decision.forwardTo ? decision.forwardTo : null;
	// A forward rule without a kept copy runs first: whether it went out decides whether we store.
	if (ruleForward && !decision?.keepCopy) {
		if (await actions.forward?.(ruleForward, marker)) return { action: "forward", forwardedTo: ruleForward };
	}

	// Same order as the Worker handler, for the same reason: a failure makes the caller retry the
	// delivery (451, a non-2xx to the relay or provider), so the lookup, the write and the enqueue
	// all happen before any forward that accompanies a stored copy. Those run last and their
	// failures are only logged, so a retry never sends them twice.
	const accountForward = alreadyForwarded ? null : await getAccountForwardingDestination(env, input.to, decision);

	// A relay retry replays the same bytes, so key the object on a content hash
	// (scoped by mailbox): the consumer dedupes by `(mailboxId, rawR2Key)`.
	const rawR2Key = await inboundStorageKey(input.raw, decision?.mailbox?.mailboxId);
	await env.BUCKET.put(rawR2Key, input.raw, {
		httpMetadata: { contentType: "message/rfc822" },
		// The receiving side's verdicts ride along so a message recovered after a Node restart
		// (server/runtime/inbound-recovery.ts) keeps its authentication signals.
		customMetadata: { from: input.from, to: input.to, ...inboundTraceMetadata(input) },
	});
	const payload: InboundQueueMessage = { from: input.from, to: input.to, rawR2Key, headers: input.headers, verdicts: input.verdicts, senderIp: input.senderIp };
	await env.INBOUND_QUEUE.send(payload);

	const forwardAfterStore = async (destination: string) => {
		try {
			return !!(await actions.forward?.(destination, marker));
		} catch (error) {
			console.error(`Forwarding failed for ${input.to} -> ${destination}`, error);
			return false;
		}
	};
	if (ruleForward && decision?.keepCopy && await forwardAfterStore(ruleForward)) forwardedTo = ruleForward;
	if (accountForward) await forwardAfterStore(accountForward);
	return { action: "store", rawR2Key, forwardedTo };
}
