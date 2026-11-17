"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import { AUTH_SESSION_CHANGED_EVENT, authFetch } from "@/lib/auth/client";
import { readInitialAssistantAvailability, saveAssistantAvailability } from "@/lib/agent/availability-client";
import { peekBootstrapPart } from "@/lib/bootstrap/client";
import { fetchSessionInfo } from "@/hooks/use-current-user";
import type { AssistantAvailabilityResponse } from "./assistant-availability-types";

const AVAILABILITY_TTL_MS = 60_000;
let lastCheckedAt = 0;

export function useAssistantAvailability() {
	const [enabled, setEnabled] = useState<boolean | null>(null);
	// eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is client-only; reading it in a lazy initialiser would mismatch the server-rendered markup.
	useLayoutEffect(() => setEnabled(readInitialAssistantAvailability()), []);

	useEffect(() => {
		let active = true;
		const refresh = async (force = false) => {
			if (!force && Date.now() - lastCheckedAt < AVAILABILITY_TTL_MS) return;
			lastCheckedAt = Date.now();
			try {
				if (force) {
					// The session read (shared with the auth guard) carries the flag when it went through
					// /api/bootstrap; signed-out visitors need no answer at all.
					const session = await fetchSessionInfo();
					if (session?.status === 401) {
						lastCheckedAt = 0;
						return;
					}
					const seeded = peekBootstrapPart("assistantEnabled", AVAILABILITY_TTL_MS);
					if (typeof seeded === "boolean") {
						if (active) setEnabled(seeded);
						return;
					}
				}
				const response = await authFetch("/api/agent/availability", { redirectOnUnauthorized: false });
				if (!response.ok) {
					lastCheckedAt = 0;
					return;
				}
				const data = await response.json() as AssistantAvailabilityResponse;
				if (active) {
					setEnabled(data.enabled);
					saveAssistantAvailability(data.enabled);
				}
			} catch {
				lastCheckedAt = 0;
			}
		};
		const onFocus = () => { void refresh(); };
		const onSessionChange = () => { void refresh(true); };
		const onVisibilityChange = () => { if (!document.hidden) void refresh(); };
		void refresh(true);
		window.addEventListener("focus", onFocus);
		window.addEventListener(AUTH_SESSION_CHANGED_EVENT, onSessionChange);
		document.addEventListener("visibilitychange", onVisibilityChange);
		return () => {
			active = false;
			window.removeEventListener("focus", onFocus);
			window.removeEventListener(AUTH_SESSION_CHANGED_EVENT, onSessionChange);
			document.removeEventListener("visibilitychange", onVisibilityChange);
		};
	}, []);

	return enabled;
}
