import { NextResponse } from "next/server";
import { getEnv } from "@/lib/cloudflare";
import { intakeIncomingMail } from "@/lib/email/intake";
import { verifyInboundSignature, verifyInboundSignatureV2 } from "@/lib/email/intake-signature";
import { inboundAttachmentLimitReasonFromScan } from "@/lib/email/inbound-attachments";
import { hasReplayMarker, rememberReplayMarker, RELAY_REPLAY_WINDOW } from "@/lib/email/replay-markers";
import { readBodyWithLimit } from "@/lib/http/limited-body";

export const dynamic = "force-dynamic";

/**
 * Inbound mail from the Cloudflare email relay Worker (deploy/cloudflare-email-relay).
 * The body is the raw RFC 5322 message; envelope addresses travel in headers and
 * the request is HMAC-signed with INBOUND_WEBHOOK_SECRET. The response tells the
 * relay whether to reject or forward, since only it can act on the live message.
 */
export async function POST(request: Request) {
	const env = getEnv();
	const secret = env.INBOUND_WEBHOOK_SECRET?.trim();
	if (!secret) return NextResponse.json({ error: "INBOUND_WEBHOOK_SECRET is not configured" }, { status: 503 });

	const raw = await readBodyWithLimit(request, 25 * 1024 * 1024);
	if (!raw) return NextResponse.json({ error: "Message exceeds the 25 MiB receiving limit" }, { status: 413 });
	const from = request.headers.get("x-mailclaw-from") ?? "";
	const to = request.headers.get("x-mailclaw-to") ?? "";
	const signature = request.headers.get("x-mailclaw-signature") ?? "";
	const headerMap = request.headers.get("x-mailclaw-headers") ?? "{}";
	const timestamp = request.headers.get("x-mailclaw-timestamp");
	// Relays that send a timestamp sign the header map too and cannot be replayed; older relays only
	// sign the body, which stays accepted unless INBOUND_REQUIRE_SIGNED_HEADERS is set.
	const valid = !from || !to
		? false
		: timestamp
			? await verifyInboundSignatureV2(secret, signature, raw, from, to, headerMap, timestamp)
			: env.INBOUND_REQUIRE_SIGNED_HEADERS !== "1" && await verifyInboundSignature(secret, signature, raw, from, to);
	if (!valid) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
	if (timestamp) {
		// The signature is hex, so it is a safe key; markers expire with the signature window.
		if (await hasReplayMarker(env.BUCKET, RELAY_REPLAY_WINDOW, signature)) return NextResponse.json({ error: "Replayed request" }, { status: 409 });
		await rememberReplayMarker(env.BUCKET, RELAY_REPLAY_WINDOW, signature);
	}
	// A linear scan, as in the Worker email handler: the queue consumer parses once and re-checks every limit.
	const attachmentLimitReason = inboundAttachmentLimitReasonFromScan(raw);
	if (attachmentLimitReason) return NextResponse.json({ action: "reject", reason: attachmentLimitReason });

	let headers: Record<string, string> = {};
	try {
		headers = JSON.parse(headerMap) as Record<string, string>;
	} catch {
		// The header map is advisory; the raw message is authoritative.
	}

	let forwardTo: string | null = null;
	let forwardHeaders: Record<string, string> = {};
	const result = await intakeIncomingMail(
		env,
		{ from, to, raw, headers },
		{
			// The relay performs the forward on the live message; report it as done so keep-copy applies.
			forward: async (destination, extra) => {
				forwardTo = destination;
				forwardHeaders = extra;
				return true;
			},
		},
	);
	return NextResponse.json({ ...result, forwardTo, forwardHeaders });
}
