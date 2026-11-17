import type { NewMessageEvent } from "./message-realtime-types";
import { hasActivePushSubscription } from "@/lib/push/client";
import { formatSenderLabel } from "@/lib/email/sender-label";

export const REALTIME_FALLBACK_INTERVAL_MS = 60_000;
export const REALTIME_HEARTBEAT_INTERVAL_MS = 25_000;
/** How often a visible tab asks the hub whether a notification was missed. */
export const REALTIME_REVISION_CHECK_INTERVAL_MS = 5 * 60_000;
/** Answered by the Durable Object's auto-response without waking it. */
export const REALTIME_KEEPALIVE_MESSAGE = "ping";
export const REALTIME_RECONNECT_MAX_MS = 30_000;
const BROWSER_NOTIFICATIONS_ENABLED_KEY = "mailclaw:browser-notifications-enabled";

export function areBrowserNotificationsEnabled(): boolean {
	try {
		return window.localStorage.getItem(BROWSER_NOTIFICATIONS_ENABLED_KEY) !== "false";
	} catch {
		return true;
	}
}

export function setBrowserNotificationsEnabled(enabled: boolean): void {
	window.localStorage.setItem(BROWSER_NOTIFICATIONS_ENABLED_KEY, String(enabled));
}

export function getRealtimeWebSocketUrl(): string {
	const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
	return `${protocol}//${window.location.host}/api/realtime`;
}

export function getReconnectDelay(attempt: number): number {
	return Math.min(1_000 * 2 ** attempt, REALTIME_RECONNECT_MAX_MS);
}

export function createRevisionCheckMessage(revision: string | null): string {
	return JSON.stringify({ type: "ping", revision });
}

/**
 * What one heartbeat tick sends. Most ticks are the bare keep-alive, which
 * costs no Durable Object wake-up or database query; a visible tab adds a
 * revision check every REALTIME_REVISION_CHECK_INTERVAL_MS to catch a
 * notification lost in transit. Hidden tabs never check: becoming visible
 * refreshes the views anyway.
 */
export function getHeartbeatMessage(input: {
	now: number;
	lastRevisionCheckAt: number;
	visible: boolean;
	revision: string | null;
}): string {
	if (input.visible && input.now - input.lastRevisionCheckAt >= REALTIME_REVISION_CHECK_INTERVAL_MS) {
		return createRevisionCheckMessage(input.revision);
	}
	return REALTIME_KEEPALIVE_MESSAGE;
}

export function parseNewMessageEvent(value: string): NewMessageEvent | null {
	try {
		const payload = JSON.parse(value) as Partial<NewMessageEvent>;
		if (
			payload.type !== "new_message" ||
			typeof payload.messageId !== "string" ||
			typeof payload.mailboxId !== "string" ||
			typeof payload.from !== "string"
		) {
			return null;
		}

		return {
			type: "new_message",
			messageId: payload.messageId,
			mailboxId: payload.mailboxId,
			from: payload.from,
			fromName: typeof payload.fromName === "string" ? payload.fromName : null,
			subject: typeof payload.subject === "string" ? payload.subject : null,
		};
	} catch {
		return null;
	}
}

export async function showBrowserNewMessageNotification(event: NewMessageEvent): Promise<void> {
	if (
		typeof Notification === "undefined" ||
		Notification.permission !== "granted" ||
		!areBrowserNotificationsEnabled() ||
		document.visibilityState === "visible"
	) {
		return;
	}
	if (await hasActivePushSubscription().catch(() => false)) return;

	try {
		const notification = new Notification(event.subject || "New email", {
			// Same label as Web Push: the name beside the real address.
			body: `From ${formatSenderLabel(event.from, event.fromName)}`,
			icon: "/icon-96.png",
			tag: event.messageId,
		});
		notification.onclick = () => {
			window.focus();
			// eslint-disable-next-line nextjs-js/no-location-assign-relative-destination -- runs from a Notification click outside React, where no router is available
			window.location.assign(`/inbox/${event.messageId}`);
			notification.close();
		};
	} catch {
		// The in-app new message popup still handles this email.
	}
}
