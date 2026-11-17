"use client";

import { useEffect, useState } from "react";
import { AUTH_SESSION_CHANGED_EVENT, authFetch } from "@/lib/auth/client";
import { applyBootstrap, clearBootstrapParts, requestBootstrap } from "@/lib/bootstrap/client";

export type CurrentUser = {
	id: string;
	email: string;
	name: string;
	role: "admin" | "user";
	isPrimaryAdmin: boolean;
	canManageMailboxes: boolean;
	canManageDomains: boolean;
	canManageUsers: boolean;
	calendarEnabled: boolean;
	driveEnabled: boolean;
	hasAvatar: boolean;
	keyboardShortcutsEnabled?: boolean;
};

export type SessionInfo = {
	status: number;
	hasMailboxes?: boolean;
	isSetup?: boolean;
	user?: (CurrentUser & { timeZone?: string | null }) | null;
};

const SESSION_INFO_MAX_AGE_MS = 5 * 60 * 1000;

let cachedSession: { info: SessionInfo; at: number } | null = null;
let cachedUser: CurrentUser | null = null;
let inflight: Promise<SessionInfo | null> | null = null;
let userRequest: { session: Promise<SessionInfo | null>; user: Promise<CurrentUser | null> } | null = null;
let generation = 0;
// The first session read of a page (and of each new sign-in) goes through `/api/bootstrap`, which also
// answers the mailbox list and the small flags; later refreshes only need `/api/auth/me`.
let bootstrapPending = true;

export function clearCurrentUserCache(): void {
	generation += 1;
	cachedSession = null;
	cachedUser = null;
	inflight = null;
	userRequest = null;
	bootstrapPending = true;
	clearBootstrapParts();
}

if (typeof window !== "undefined") window.addEventListener(AUTH_SESSION_CHANGED_EVENT, clearCurrentUserCache);

/** The cached answer if it is still fresh, without a request. */
export function peekSessionInfo(): SessionInfo | null {
	return cachedSession && Date.now() - cachedSession.at < SESSION_INFO_MAX_AGE_MS ? cachedSession.info : null;
}

async function requestAuthMe(): Promise<SessionInfo> {
	const cookieResponse = await fetch("/api/auth/me", { cache: "no-store", signal: AbortSignal.timeout(5_000) });
	const response = cookieResponse.ok || cookieResponse.status !== 401
		? cookieResponse
		: await authFetch("/api/auth/me", { redirectOnUnauthorized: false, signal: AbortSignal.timeout(5_000) });
	if (!response.ok) return { status: response.status };
	const data = (await response.json()) as Omit<SessionInfo, "status">;
	return { status: response.status, ...data };
}

type SessionRead = { info: SessionInfo; seed?: () => void };

async function requestSessionInfo(): Promise<SessionRead> {
	if (!bootstrapPending) return { info: await requestAuthMe() };
	const { status, data } = await requestBootstrap().catch(() => ({ status: 0, data: undefined }));
	// Only a signed-in answer or a definite 401 is final; anything else (an older deployment
	// without the route, a network error) falls back to the session endpoint.
	if (status === 401) return { info: { status } };
	if (!data) return { info: await requestAuthMe() };
	return {
		info: { status, ...(data.session as Omit<SessionInfo, "status">) },
		seed: () => {
			bootstrapPending = false;
			applyBootstrap(data);
		},
	};
}

/** Mirrors a setting saved elsewhere into the cached session, so the next reader sees it. */
export function updateCachedSessionUser(patch: Partial<NonNullable<SessionInfo["user"]>>): void {
	if (cachedSession?.info.user) {
		cachedSession = { ...cachedSession, info: { ...cachedSession.info, user: { ...cachedSession.info.user, ...patch } } };
	}
	if (cachedUser) cachedUser = { ...cachedUser, ...patch };
}

/**
 * The `/api/auth/me` answer (first read through `/api/bootstrap`) shared by the auth guard, sidebar and account menus,
 * so navigating does not refetch it. `fresh` bypasses the cache; network
 * failures resolve to null and are never cached.
 */
export function fetchSessionInfo({ fresh = false }: { fresh?: boolean } = {}): Promise<SessionInfo | null> {
	const cached = fresh ? null : peekSessionInfo();
	if (cached) return Promise.resolve(cached);
	if (!inflight) {
		const requestGeneration = generation;
		const request = requestSessionInfo()
			.then(({ info, seed }) => {
				if (requestGeneration !== generation) return null;
				seed?.();
				cachedSession = info.status === 200 ? { info, at: Date.now() } : null;
				cachedUser = info.user ?? null;
				return info;
			})
			.catch(() => null)
			.finally(() => {
				if (inflight === request) inflight = null;
			});
		inflight = request;
	}
	return inflight;
}

export function fetchCurrentUser(): Promise<CurrentUser | null> {
	if (cachedUser) return Promise.resolve(cachedUser);
	const session = fetchSessionInfo();
	if (!userRequest || userRequest.session !== session) {
		userRequest = { session, user: session.then((info) => info?.user ?? null) };
	}
	return userRequest.user;
}

export function useCurrentUser(): CurrentUser | null {
	const [user, setUser] = useState<CurrentUser | null>(cachedUser);
	const [reloadKey, setReloadKey] = useState(0);

	useEffect(() => {
		let active = true;
		const requestGeneration = generation;
		void fetchCurrentUser().then((next) => {
			if (active && requestGeneration === generation) setUser(next);
		});
		return () => {
			active = false;
		};
	}, [reloadKey]);

	// Login and logout swap the cached account without a reload, so refetch when the session changes.
	useEffect(() => {
		function onSessionChanged() {
			clearCurrentUserCache();
			setUser(null);
			setReloadKey((key) => key + 1);
		}
		window.addEventListener(AUTH_SESSION_CHANGED_EVENT, onSessionChanged);
		return () => window.removeEventListener(AUTH_SESSION_CHANGED_EVENT, onSessionChanged);
	}, []);

	return user;
}
