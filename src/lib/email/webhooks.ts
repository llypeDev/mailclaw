import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import type { AppDatabase } from "@/db";
import { webhookDeliveries, webhooks } from "@/db/schema";
import { newId } from "@/lib/ids";
import { assertResolvesPublic, isPublicHttpsUrl, PUBLIC_HTTPS_URL_MESSAGE } from "@/lib/security/public-url";

export type WebhookEventType = "message.inbound" | "message.outbound" | "message.failed";

export const WEBHOOK_EVENT_TYPES: WebhookEventType[] = [
	"message.inbound",
	"message.outbound",
	"message.failed",
];

/**
 * Delivery work is carried on the existing outbound queue so no new binding is required. The first
 * attempt rides it too (with no delay), so a slow endpoint never holds up the inbound or send path
 * that raised the event; the kind keeps its historical name.
 */
export type WebhookRetryMessage = {
	kind: "webhook.retry";
	deliveryId: string;
};

export type WebhookDeliveryStatus = "pending" | "delivered" | "failed" | "retrying" | "exhausted";

type WebhookRow = typeof webhooks.$inferSelect;
type DeliveryRow = typeof webhookDeliveries.$inferSelect;

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_SNIPPET = 500;

/** Exponential backoff, capped at one hour: 1m, 2m, 4m, 8m, 16m... */
export function getRetryDelaySeconds(attempt: number): number {
	return Math.min(60 * 2 ** Math.max(attempt - 1, 0), 3600);
}

export function parseWebhookEvents(events: string): string[] {
	try {
		const parsed = JSON.parse(events);
		return Array.isArray(parsed) ? parsed.filter((e): e is string => typeof e === "string") : [];
	} catch {
		return [];
	}
}

export async function dispatchWebhooks(
	env: CloudflareEnv,
	userId: string,
	eventType: WebhookEventType,
	payload: Record<string, unknown>,
): Promise<void> {
	const db = getDb(env);
	const hooks = await db.select().from(webhooks).where(eq(webhooks.userId, userId));
	const subscribed = hooks.filter((hook) => hook.enabled && parseWebhookEvents(hook.events).includes(eventType));
	if (subscribed.length === 0) return;

	const body = JSON.stringify({ type: eventType, data: payload });
	// Record every delivery before anything is sent, so each attempt (and the deliveries page) has a row to update.
	const queued: Array<{ hook: WebhookRow; delivery: PendingDelivery }> = [];
	for (const hook of subscribed) {
		try {
			queued.push({ hook, delivery: await createDelivery(db, hook.id, eventType, body) });
		} catch (error) {
			console.error(`Webhook dispatch failed for ${hook.id}`, error);
		}
	}
	if (queued.length === 0) return;

	if (await enqueueDeliveries(env, queued.map(({ delivery }) => delivery.id))) return;

	// The queue refused the work: deliver inline as before rather than leave the rows pending forever.
	for (const { hook, delivery } of queued) {
		try {
			await attemptDelivery(env, db, hook, delivery);
		} catch (error) {
			console.error(`Webhook dispatch failed for ${hook.id}`, error);
		}
	}
}

/** Queues the first attempt of each delivery. False when the queue could not take them. */
async function enqueueDeliveries(env: CloudflareEnv, deliveryIds: string[]): Promise<boolean> {
	const messages: WebhookRetryMessage[] = deliveryIds.map((deliveryId) => ({ kind: "webhook.retry", deliveryId }));
	try {
		if (messages.length === 1) await env.OUTBOUND_QUEUE.send(messages[0]);
		else await env.OUTBOUND_QUEUE.sendBatch(messages.map((body) => ({ body })));
		return true;
	} catch (error) {
		console.error("Failed to queue webhook deliveries; delivering inline", error);
		return false;
	}
}

type PendingDelivery = Pick<DeliveryRow, "id" | "payload" | "eventType" | "attempts">;

async function createDelivery(
	db: AppDatabase,
	webhookId: string,
	eventType: string,
	payload: string,
): Promise<PendingDelivery> {
	const id = newId("whd");
	await db.insert(webhookDeliveries).values({
		id,
		webhookId,
		eventType,
		payload,
		status: "pending",
		attempts: 0,
	});
	return { id, payload, eventType, attempts: 0 };
}

/** Runs one delivery attempt and records the outcome, scheduling a retry when it fails. */
async function attemptDelivery(
	env: CloudflareEnv,
	db: AppDatabase,
	hook: WebhookRow,
	delivery: PendingDelivery,
): Promise<WebhookDeliveryStatus> {
	const attempts = delivery.attempts + 1;
	const startedAt = Date.now();
	const now = new Date();

	let responseStatus: number | null = null;
	let error: string | null = null;

	try {
		// Hooks saved before URL validation existed must not become an SSRF path.
		if (!isPublicHttpsUrl(hook.url)) throw new Error(PUBLIC_HTTPS_URL_MESSAGE);
		await assertResolvesPublic(new URL(hook.url).hostname);
		const signature = await signPayload(hook.secret, delivery.payload);
		const res = await fetch(hook.url, {
			method: "POST",
			redirect: "manual",
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			headers: {
				"Content-Type": "application/json",
				"X-Email-Platform-Signature": signature,
				"X-Email-Platform-Event": delivery.eventType,
				"X-Email-Platform-Delivery": delivery.id,
				"X-Email-Platform-Attempt": String(attempts),
			},
			body: delivery.payload,
		});
		responseStatus = res.status;
		if (!res.ok) {
			error = (await readResponseSnippet(res)) || `Endpoint responded with ${res.status}`;
		}
	} catch (err) {
		error = err instanceof Error ? err.message : "Request failed";
	}

	const durationMs = Date.now() - startedAt;
	const delivered = !error;
	const canRetry = !delivered && attempts < hook.maxAttempts;
	const status: WebhookDeliveryStatus = delivered ? "delivered" : canRetry ? "retrying" : "exhausted";
	const nextRetryAt = canRetry ? new Date(Date.now() + getRetryDelaySeconds(attempts) * 1000) : null;

	await db
		.update(webhookDeliveries)
		.set({
			status,
			attempts,
			responseStatus,
			error: error ? error.slice(0, MAX_RESPONSE_SNIPPET) : null,
			durationMs,
			lastAttemptAt: now,
			nextRetryAt,
		})
		.where(eq(webhookDeliveries.id, delivery.id));

	if (canRetry) {
		await scheduleRetry(env, delivery.id, getRetryDelaySeconds(attempts));
	}

	return status;
}

async function scheduleRetry(env: CloudflareEnv, deliveryId: string, delaySeconds: number): Promise<void> {
	const message: WebhookRetryMessage = { kind: "webhook.retry", deliveryId };
	try {
		await env.OUTBOUND_QUEUE.send(message, { delaySeconds });
	} catch (error) {
		console.error(`Failed to schedule webhook retry for ${deliveryId}`, error);
	}
}

/** Queue consumer entry point for first attempts and scheduled retries. */
export async function processWebhookRetry(
	env: CloudflareEnv,
	message: WebhookRetryMessage,
): Promise<void> {
	// Queues deliver at least once: a redelivered message must not post a settled delivery again.
	await runDelivery(env, message.deliveryId, { skipSettled: true });
}

/** Delivered, or out of attempts: only the manual retry button may run these again. */
export function isSettledDeliveryStatus(status: string): boolean {
	return status === "delivered" || status === "exhausted";
}

/**
 * Runs (or re-runs) a delivery. Used by the retry queue and by the manual retry button.
 * Returns null when the delivery or its webhook no longer exists.
 */
export async function runDelivery(
	env: CloudflareEnv,
	deliveryId: string,
	options?: { userId?: string; skipSettled?: boolean },
): Promise<{ status: WebhookDeliveryStatus } | null> {
	const db = getDb(env);
	const [delivery] = await db
		.select()
		.from(webhookDeliveries)
		.where(eq(webhookDeliveries.id, deliveryId))
		.limit(1);
	if (!delivery) return null;
	if (options?.skipSettled && isSettledDeliveryStatus(delivery.status)) return { status: delivery.status as WebhookDeliveryStatus };

	const [hook] = await db.select().from(webhooks).where(eq(webhooks.id, delivery.webhookId)).limit(1);
	if (!hook) return null;
	if (options?.userId && hook.userId !== options.userId) return null;

	return { status: await attemptDelivery(env, db, hook, delivery) };
}

/** Sends a synthetic event so an operator can verify an endpoint from the UI. */
export async function sendTestDelivery(
	env: CloudflareEnv,
	hook: WebhookRow,
): Promise<{ deliveryId: string; status: WebhookDeliveryStatus }> {
	const db = getDb(env);
	const body = JSON.stringify({
		type: "message.inbound",
		test: true,
		data: {
			messageId: "test",
			from: "postmaster@example.com",
			to: "inbox@example.com",
			subject: "Mailclaw test delivery",
		},
	});
	const delivery = await createDelivery(db, hook.id, "message.inbound", body);
	const status = await attemptDelivery(env, db, hook, delivery);
	return { deliveryId: delivery.id, status };
}

async function readResponseSnippet(res: Response): Promise<string> {
	try {
		const text = await res.text();
		return text.trim().slice(0, MAX_RESPONSE_SNIPPET);
	} catch {
		return "";
	}
}

async function signPayload(secret: string, body: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
	return Array.from(new Uint8Array(sig))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}
