import { useCallback, useEffect, useState } from "react";
import {
	AUTH_SESSION_CHANGED_EVENT,
	getClientSessionToken,
} from "@/lib/auth/client";
import type {
	MessageRealtimeState,
	NewMessageEvent,
	RealtimeChannelMessage,
} from "./message-realtime-types";
import {
	createRevisionCheckMessage,
	getHeartbeatMessage,
	getRealtimeWebSocketUrl,
	getReconnectDelay,
	parseNewMessageEvent,
	REALTIME_FALLBACK_INTERVAL_MS,
	REALTIME_HEARTBEAT_INTERVAL_MS,
	REALTIME_KEEPALIVE_MESSAGE,
	showBrowserNewMessageNotification,
} from "./message-realtime-utils";

export function useMessagePolling(): MessageRealtimeState {
	const [notification, setNotification] = useState<NewMessageEvent | null>(null);
	const dismissNotification = useCallback(() => setNotification(null), []);

	useEffect(() => {
		let socket: WebSocket | null = null;
		let channel: BroadcastChannel | null = null;
		let lockAbort: AbortController | null = null;
		let releaseLeader: (() => void) | null = null;
		let reconnectTimer: number | null = null;
		let heartbeatTimer: number | null = null;
		let fallbackTimer: number | null = null;
		let reconnectAttempt = 0;
		let revision: string | null = null;
		let lastRevisionCheckAt = 0;
		let connected = false;
		let hadConnection = false;
		let lastForegroundRefreshAt = 0;
		let leader = false;
		let sessionToken = getClientSessionToken();
		let stopped = false;

		function dispatchMessagesChanged(detail?: Record<string, unknown>) {
			window.dispatchEvent(new CustomEvent("mailclaw:messages-changed", { detail: { ...detail, realtime: true } }));
		}

		function clearConnectionTimers() {
			if (reconnectTimer) window.clearTimeout(reconnectTimer);
			if (heartbeatTimer) window.clearInterval(heartbeatTimer);
			reconnectTimer = null;
			heartbeatTimer = null;
		}

		function startFallbackRefresh() {
			if (fallbackTimer) return;
			fallbackTimer = window.setInterval(() => {
				if (!connected && document.visibilityState === "visible") dispatchMessagesChanged();
			}, REALTIME_FALLBACK_INTERVAL_MS);
		}

		function setConnected(value: boolean) {
			connected = value;
			if (value) {
				if (fallbackTimer) window.clearInterval(fallbackTimer);
				fallbackTimer = null;
			} else {
				startFallbackRefresh();
			}
			if (leader) channel?.postMessage({ type: "status", connected: value } satisfies RealtimeChannelMessage);
		}

		function handleNotification(payload: string, fromSocket: boolean) {
			try {
				const parsed = JSON.parse(payload) as { type?: string; revision?: string; changed?: boolean; draftId?: string; mailboxId?: string };
				if (parsed.type === "revision" && typeof parsed.revision === "string") {
					revision = parsed.revision;
					if (parsed.changed) {
						dispatchMessagesChanged();
						if (fromSocket) channel?.postMessage({ type: "refresh" } satisfies RealtimeChannelMessage);
					}
					return;
				}
				if (parsed.type === "agent_draft" && parsed.draftId && parsed.mailboxId) {
					window.dispatchEvent(new CustomEvent("mailclaw:agent-draft", { detail: parsed }));
					dispatchMessagesChanged();
					if (fromSocket) channel?.postMessage({ type: "notification", payload } satisfies RealtimeChannelMessage);
					return;
				}
			} catch { return; }
			const event = parseNewMessageEvent(payload);
			if (!event) return;
			dispatchMessagesChanged();
			setNotification(event);
			if (fromSocket) {
				void showBrowserNewMessageNotification(event);
				channel?.postMessage({ type: "notification", payload } satisfies RealtimeChannelMessage);
			}
		}

		function sendRevisionCheck(knownRevision: string | null) {
			if (socket?.readyState !== WebSocket.OPEN) return;
			lastRevisionCheckAt = Date.now();
			socket.send(createRevisionCheckMessage(knownRevision));
		}

		function sendHeartbeat() {
			if (socket?.readyState !== WebSocket.OPEN) return;
			const now = Date.now();
			const message = getHeartbeatMessage({ now, lastRevisionCheckAt, visible: document.visibilityState === "visible", revision });
			if (message !== REALTIME_KEEPALIVE_MESSAGE) lastRevisionCheckAt = now;
			socket.send(message);
		}

		function scheduleReconnect() {
			setConnected(false);
			if (stopped || !leader || !getClientSessionToken()) return;
			const delay = getReconnectDelay(reconnectAttempt);
			reconnectAttempt += 1;
			reconnectTimer = window.setTimeout(connect, delay);
		}

		function connect() {
			clearConnectionTimers();
			if (stopped || !leader || !getClientSessionToken()) return;

			socket = new WebSocket(getRealtimeWebSocketUrl());
			socket.onopen = () => {
				reconnectAttempt = 0;
				revision = null;
				const reconnected = hadConnection;
				hadConnection = true;
				setConnected(true);
				if (reconnected) dispatchMessagesChanged();
				// Baseline revision; later checks compare against it.
				sendRevisionCheck(null);
				heartbeatTimer = window.setInterval(sendHeartbeat, REALTIME_HEARTBEAT_INTERVAL_MS);
			};
			socket.onmessage = (message) => {
				if (message.data === "pong" || typeof message.data !== "string") return;
				handleNotification(message.data, true);
			};
			socket.onerror = () => socket?.close();
			socket.onclose = () => {
				clearConnectionTimers();
				scheduleReconnect();
			};
		}

		function requestLeadership() {
			if (stopped || !getClientSessionToken()) return;
			if (!channel || !navigator.locks) {
				leader = true;
				connect();
				return;
			}
			lockAbort = new AbortController();
			void navigator.locks.request("mailclaw:realtime", { signal: lockAbort.signal }, async () => {
				if (stopped || !getClientSessionToken()) return;
				await new Promise<void>((resolve) => {
					releaseLeader = resolve;
					leader = true;
					connect();
				});
				leader = false;
				releaseLeader = null;
			}).catch(() => {});
		}

		function restartForSessionChange() {
			sessionToken = getClientSessionToken();
			if (socket) {
				socket.onclose = null;
				socket.close(1000, "Session changed");
				socket = null;
			}
			clearConnectionTimers();
			setConnected(false);
			lockAbort?.abort();
			releaseLeader?.();
			leader = false;
			reconnectAttempt = 0;
			revision = null;
			hadConnection = false;
			setNotification(null);
			requestLeadership();
		}

		function onChannelMessage(event: MessageEvent<RealtimeChannelMessage>) {
			const message = event.data;
			if (message?.type === "status_request" && leader) {
				channel?.postMessage({ type: "status", connected } satisfies RealtimeChannelMessage);
			} else if (message?.type === "status" && !leader) {
				const wasConnected = connected;
				setConnected(message.connected);
				if (message.connected && !wasConnected) dispatchMessagesChanged();
			} else if (message?.type === "notification" && !leader) {
				handleNotification(message.payload, false);
			} else if (message?.type === "refresh") {
				dispatchMessagesChanged(message.detail);
			}
		}

		function onLocalMessagesChanged(event: Event) {
			const detail = (event as CustomEvent<Record<string, unknown> | undefined>).detail;
			if (detail?.realtime) return;
			channel?.postMessage({ type: "refresh", detail } satisfies RealtimeChannelMessage);
		}

		function refreshOnForeground(force: boolean) {
			if (document.visibilityState !== "visible") return;
			const now = Date.now();
			if (connected && !force) return;
			if (now - lastForegroundRefreshAt < 1_000) return;
			lastForegroundRefreshAt = now;
			dispatchMessagesChanged();
		}

		function onVisibilityChange() {
			if (document.visibilityState !== "visible") return;
			refreshOnForeground(true);
			// The views were just refreshed, so only renew the baseline (a null
			// revision never reports a change) instead of refreshing twice.
			if (leader) sendRevisionCheck(null);
		}

		function onFocus() {
			refreshOnForeground(false);
		}

		function onStorageChange() {
			if (sessionToken !== getClientSessionToken()) restartForSessionChange();
		}

		if (typeof BroadcastChannel !== "undefined") {
			channel = new BroadcastChannel("mailclaw:realtime");
			channel.onmessage = onChannelMessage;
			channel.postMessage({ type: "status_request" } satisfies RealtimeChannelMessage);
		}
		window.addEventListener(AUTH_SESSION_CHANGED_EVENT, restartForSessionChange);
		window.addEventListener("storage", onStorageChange);
		window.addEventListener("mailclaw:messages-changed", onLocalMessagesChanged);
		document.addEventListener("visibilitychange", onVisibilityChange);
		window.addEventListener("focus", onFocus);
		startFallbackRefresh();
		requestLeadership();

		return () => {
			stopped = true;
			window.removeEventListener(AUTH_SESSION_CHANGED_EVENT, restartForSessionChange);
			window.removeEventListener("storage", onStorageChange);
			window.removeEventListener("mailclaw:messages-changed", onLocalMessagesChanged);
			document.removeEventListener("visibilitychange", onVisibilityChange);
			window.removeEventListener("focus", onFocus);
			if (leader) channel?.postMessage({ type: "status", connected: false } satisfies RealtimeChannelMessage);
			lockAbort?.abort();
			releaseLeader?.();
			clearConnectionTimers();
			if (fallbackTimer) window.clearInterval(fallbackTimer);
			channel?.close();
			if (socket) {
				socket.onclose = null;
				socket.close(1000, "Client closed");
			}
		};
	}, []);

	useEffect(() => {
		if (!notification) return;
		const timer = window.setTimeout(() => setNotification(null), 8_000);
		return () => window.clearTimeout(timer);
	}, [notification]);

	return { notification, dismissNotification };
}
