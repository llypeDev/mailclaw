import { NextResponse } from "next/server";
import { getEnv } from "@/lib/cloudflare";
import { requireAwsConfig } from "@/lib/aws/config";
import { deleteObject, getObject } from "@/lib/aws/s3";
import { getSesReceivingState, SES_OBJECT_PREFIX } from "@/lib/aws/ses-receiving";
import { intakeProviderMail } from "@/lib/email/provider-intake";
import { parseSesNotification, safeEqual, type SnsEnvelope } from "@/lib/aws/ses-notification";
import { verifySnsSignature } from "@/lib/aws/sns-signature";
import { hasReplayMarker, rememberReplayMarker, SNS_REPLAY_WINDOW } from "@/lib/email/replay-markers";
import { API_TIMEOUT_MS } from "@/lib/http/fetch-timeout";
import { readBodyWithLimit } from "@/lib/http/limited-body";

/** SNS messages are at most 256 KB; the envelope adds little. */
const MAX_ENVELOPE_BYTES = 1024 * 1024;

export const dynamic = "force-dynamic";

/**
 * Amazon SNS endpoint for SES inbound mail. SNS posts JSON as text/plain.
 * Trust comes from four things: the secret token in the URL that only the subscription
 * we created knows, the SNS signature checked against Amazon's published certificate
 * (with a freshness window), the topic ARN matching ours, and the message itself being
 * read from our own S3 bucket with our credentials, so a forged notification cannot
 * inject content.
 */
export async function POST(request: Request) {
	const env = getEnv();
	const state = await getSesReceivingState(env);
	const token = new URL(request.url).searchParams.get("token") ?? "";
	if (!state || !safeEqual(token, state.token)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

	let envelope: SnsEnvelope;
	const body = await readBodyWithLimit(request, MAX_ENVELOPE_BYTES);
	if (!body) return NextResponse.json({ error: "Body too large" }, { status: 413 });
	try { envelope = JSON.parse(new TextDecoder().decode(body)) as SnsEnvelope; } catch { return NextResponse.json({ error: "Invalid body" }, { status: 400 }); }
	if (envelope.TopicArn !== state.topicArn) return NextResponse.json({ error: "Unknown topic" }, { status: 403 });
	if (!await verifySnsSignature(envelope)) return NextResponse.json({ error: "Invalid signature" }, { status: 403 });

	if (envelope.Type === "SubscriptionConfirmation") {
		const url = envelope.SubscribeURL ? new URL(envelope.SubscribeURL) : null;
		if (!url || url.protocol !== "https:" || !/^sns\.[a-z0-9-]+\.amazonaws\.com$/.test(url.hostname)) {
			return NextResponse.json({ error: "Invalid subscription URL" }, { status: 400 });
		}
		const confirmed = await fetch(url, { signal: AbortSignal.timeout(API_TIMEOUT_MS) }).catch(() => null);
		return NextResponse.json({ confirmed: !!confirmed?.ok }, { status: confirmed?.ok ? 200 : 502 });
	}
	if (envelope.Type !== "Notification") return NextResponse.json({ ignored: true });

	const notification = parseSesNotification(envelope.Message ?? "");
	if (!notification) return NextResponse.json({ ignored: true });
	if (notification.bucket !== state.bucket || !notification.key.startsWith(SES_OBJECT_PREFIX)) {
		return NextResponse.json({ error: "Unexpected object" }, { status: 400 });
	}

	// A captured, still-fresh notification replays only once: remember delivered MessageIds.
	// Markers expire with the window in which the SNS signature still verifies.
	const seenId = envelope.MessageId?.replace(/[^A-Za-z0-9-]/g, "") || null;
	if (seenId && await hasReplayMarker(env.BUCKET, SNS_REPLAY_WINDOW, seenId)) return NextResponse.json({ ignored: "Already processed" });

	const config = await requireAwsConfig(env);
	if (notification.virusFailed) {
		await deleteObject(config, state.bucket, notification.key);
		return NextResponse.json({ dropped: "Message failed the virus scan" });
	}
	const raw = await getObject(config, state.bucket, notification.key);
	const result = await intakeProviderMail(env, { from: notification.from, recipients: notification.recipients, raw, headers: notification.headers, verdicts: notification.verdicts });
	// Only after intake succeeded: a failure above returns 500 so SNS retries with the object intact.
	await deleteObject(config, state.bucket, notification.key);
	if (seenId) await rememberReplayMarker(env.BUCKET, SNS_REPLAY_WINDOW, seenId);
	return NextResponse.json(result);
}
