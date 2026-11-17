"use client";

import { getUserTimeZone } from "@/lib/time/utils";
import { clearUserTimeZonePreference } from "@/lib/time/client";
import type {
	AuthFetchOptions,
	AuthSessionChangedDetail,
	AuthSessionResponse,
} from "./client-types";
import {
	createSessionMarker,
	decideLegacyMigration,
	LEGACY_SESSION_TOKEN_STORAGE_KEY,
	readSessionMarker,
	SESSION_MARKER_STORAGE_KEY,
} from "./client-utils";

export const AUTH_SESSION_CHANGED_EVENT = "mailclaw:auth-session-changed";

function dispatchAuthSessionChanged(authenticated: boolean): void {
	if (typeof window === "undefined") return;
	window.dispatchEvent(
		new CustomEvent<AuthSessionChangedDetail>(AUTH_SESSION_CHANGED_EVENT, {
			detail: { authenticated },
		}),
	);
}

function readLegacyToken(): string | null {
	if (typeof window === "undefined") return null;
	try {
		return localStorage.getItem(LEGACY_SESSION_TOKEN_STORAGE_KEY);
	} catch {
		return null;
	}
}

/**
 * The non-secret marker of the session this browser is signed in with, or
 * null when signed out. It is NOT a credential: the session itself is the
 * httpOnly cookie. Callers compare it to notice an account change, and test
 * it for "signed in". (The name predates the cookie-only session.)
 */
export function getClientSessionToken(): string | null {
	if (typeof window === "undefined") return null;
	try {
		return readSessionMarker(localStorage);
	} catch {
		return null;
	}
}

export const getClientSessionMarker = getClientSessionToken;

/** Record that the cookie now holds a new session (login or account switch). */
export function markClientSessionActive(): void {
	localStorage.setItem(SESSION_MARKER_STORAGE_KEY, createSessionMarker());
	localStorage.removeItem(LEGACY_SESSION_TOKEN_STORAGE_KEY);
	clearUserTimeZonePreference();
	dispatchAuthSessionChanged(true);
}

/**
 * Kept for callers written when the client stored the token. The argument is
 * ignored and never stored; this only marks a new session as active.
 */
export function setClientSessionToken(_token?: string): void {
	markClientSessionActive();
}

export function clearClientSessionToken(): void {
	localStorage.removeItem(SESSION_MARKER_STORAGE_KEY);
	localStorage.removeItem(LEGACY_SESSION_TOKEN_STORAGE_KEY);
	clearUserTimeZonePreference();
	dispatchAuthSessionChanged(false);
}

export function getAuthHeaders(headers?: HeadersInit): Headers {
	const nextHeaders = new Headers(headers);
	if (typeof window !== "undefined" && !nextHeaders.has("X-Time-Zone")) {
		nextHeaders.set("X-Time-Zone", getUserTimeZone());
	}
	// Only a token left by an older client, until it has moved into the cookie
	// (or for good when this browser refuses the cookie). New sessions have none.
	const legacyToken = readLegacyToken();
	if (legacyToken && !nextHeaders.has("Authorization")) {
		nextHeaders.set("Authorization", `Bearer ${legacyToken}`);
	}
	return nextHeaders;
}

async function readUserId(response: Response): Promise<string | undefined> {
	const data = (await response.json().catch(() => null)) as { userId?: unknown } | null;
	return typeof data?.userId === "string" ? data.userId : undefined;
}

let legacyMigration: Promise<void> | null = null;

async function migrateLegacySession(token: string): Promise<void> {
	let adopt: { status: number; userId?: string } | null = null;
	let check: { status: number; userId?: string } | null = null;
	try {
		const adoptResponse = await fetch("/api/auth/session", {
			method: "POST",
			headers: { Authorization: `Bearer ${token}` },
			cache: "no-store",
		});
		adopt = { status: adoptResponse.status, userId: await readUserId(adoptResponse) };
		const checkResponse = await fetch("/api/auth/session", { cache: "no-store" });
		check = { status: checkResponse.status, userId: await readUserId(checkResponse) };
	} catch {
		// Offline or the server is unreachable: keep the token and try on the next page load.
	}
	if (readLegacyToken() !== token) return;
	const outcome = decideLegacyMigration(adopt, check);
	if (outcome.kind === "migrated") {
		// Same marker as before (derived from the token), so nothing looks switched.
		const marker = readSessionMarker(localStorage);
		if (marker) localStorage.setItem(SESSION_MARKER_STORAGE_KEY, marker);
		localStorage.removeItem(LEGACY_SESSION_TOKEN_STORAGE_KEY);
	} else if (outcome.kind === "replaced") {
		markClientSessionActive();
	} else if (outcome.kind === "dropped") {
		localStorage.removeItem(LEGACY_SESSION_TOKEN_STORAGE_KEY);
	}
}

/**
 * Clients before the cookie-only change kept the session token in
 * localStorage. Move it into the httpOnly cookie once per page load so those
 * browsers stay signed in without keeping a readable credential.
 */
function ensureLegacySessionMigrated(): Promise<void> {
	const token = readLegacyToken();
	if (!token) return Promise.resolve();
	legacyMigration ??= migrateLegacySession(token);
	return legacyMigration;
}

export async function authFetch(input: RequestInfo | URL, init: AuthFetchOptions = {}): Promise<Response> {
	const { redirectOnUnauthorized = true, headers, ...requestInit } = init;
	await ensureLegacySessionMigrated();
	const response = await fetch(input, {
		...requestInit,
		headers: getAuthHeaders(headers),
	});

	if (response.status === 401 && redirectOnUnauthorized && typeof window !== "undefined") {
		clearClientSessionToken();
		// eslint-disable-next-line nextjs-js/no-location-assign-relative-destination -- plain fetch helper with no router; a full load also drops every cached client state of the expired session
		window.location.assign("/login");
	}

	return response;
}

/** Reads a sign-in response; on success marks the new cookie session active. */
export async function persistAuthSession(response: Response): Promise<AuthSessionResponse> {
	const data = (await response.json()) as AuthSessionResponse;
	if (response.ok && (data.authenticated || data.token)) markClientSessionActive();
	return data;
}
