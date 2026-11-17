"use client";

import { authFetch } from "@/lib/auth/client";
import { saveAssistantAvailability } from "@/lib/agent/availability-client";
import { seedMailboxesCache, toMailboxOptions } from "@/components/mailbox-provider-utils";
import type { MailboxOption } from "@/components/mailbox-provider";
import { BOOTSTRAP_PATH, EARLY_BOOTSTRAP_GLOBAL, EARLY_BOOTSTRAP_MAX_AGE_MS } from "./utils";
import type { BootstrapExtras, BootstrapResponse, EarlyBootstrap } from "./types";

const REQUEST_TIMEOUT_MS = 10_000;

type Parts = { [K in keyof BootstrapExtras]?: { value: BootstrapExtras[K]; at: number } };
let parts: Parts = {};

/** The response the inline script started during HTML parsing, handed out once. */
function takeEarlyBootstrap(): Promise<Response | null> | null {
	if (typeof window === "undefined") return null;
	const holder = window as unknown as Record<string, EarlyBootstrap | undefined>;
	const early = holder[EARLY_BOOTSTRAP_GLOBAL];
	if (!early) return null;
	holder[EARLY_BOOTSTRAP_GLOBAL] = undefined;
	return Date.now() - early.at < EARLY_BOOTSTRAP_MAX_AGE_MS ? early.response : null;
}

/**
 * Reads `/api/bootstrap` like `/api/auth/me` is read: the session cookie first (reusing the request
 * the page already started, if any), then the stored bearer token when the cookie is not accepted.
 */
export async function requestBootstrap(): Promise<{ status: number; data?: BootstrapResponse }> {
	const request = () => fetch(BOOTSTRAP_PATH, { cache: "no-store", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
	// Without an early response the request starts synchronously, like the `/api/auth/me` read it replaces.
	const early = takeEarlyBootstrap();
	const cookieResponse = await (early ? early.then((response) => response ?? request()) : request());
	const response = cookieResponse.ok || cookieResponse.status !== 401
		? cookieResponse
		: await authFetch(BOOTSTRAP_PATH, { redirectOnUnauthorized: false, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
	if (!response.ok) return { status: response.status };
	return { status: response.status, data: (await response.json()) as BootstrapResponse };
}

/** Seeds the client caches the bootstrap answers for, so their hooks skip their own first request. */
export function applyBootstrap(data: BootstrapResponse): void {
	if (Array.isArray(data.mailboxes)) seedMailboxesCache(toMailboxOptions(data.mailboxes as MailboxOption[]));
	if (typeof data.assistantEnabled === "boolean") saveAssistantAvailability(data.assistantEnabled);
	rememberBootstrapPart("assistantEnabled", data.assistantEnabled ?? null);
	rememberBootstrapPart("dnsSkippedDomains", data.dnsSkippedDomains ?? null);
}

/**
 * A bootstrap part read within `maxAgeMs`, or `undefined` when there is none that recent. `null` means
 * the server could not read it (or, for the DNS banner, that it does not apply to this user).
 */
export function peekBootstrapPart<K extends keyof BootstrapExtras>(key: K, maxAgeMs: number): BootstrapExtras[K] | undefined {
	const part = parts[key];
	return part && Date.now() - part.at < maxAgeMs ? part.value as BootstrapExtras[K] : undefined;
}

/** Keeps a part current after its own endpoint answered, so a remount does not show the old value. */
export function rememberBootstrapPart<K extends keyof BootstrapExtras>(key: K, value: BootstrapExtras[K]): void {
	parts = { ...parts, [key]: { value, at: Date.now() } };
}

export function clearBootstrapParts(): void {
	parts = {};
}
