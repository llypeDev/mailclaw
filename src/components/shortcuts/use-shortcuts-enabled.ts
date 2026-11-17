"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchSessionInfo, peekSessionInfo, updateCachedSessionUser } from "@/hooks/use-current-user";
import { loadShortcutsEnabled, updateShortcutsEnabled } from "./use-shortcuts-enabled-utils";

/** The preference from the cached session (it is part of `/api/auth/me`), or `/api/settings/shortcuts` when absent. */
async function readShortcutsEnabled(): Promise<boolean> {
	const session = peekSessionInfo() ?? await fetchSessionInfo();
	const stored = session?.user?.keyboardShortcutsEnabled;
	return typeof stored === "boolean" ? stored : loadShortcutsEnabled();
}

/** Loads and updates the signed-in account's keyboard shortcut preference. */
export function useShortcutsEnabled() {
	// Providers mount after the auth guard has the session, so the cached answer is usually there already.
	const [cached] = useState(() => peekSessionInfo()?.user?.keyboardShortcutsEnabled);
	const [enabled, setEnabledState] = useState(cached ?? false);
	const [isLoading, setIsLoading] = useState(typeof cached !== "boolean");
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (typeof cached === "boolean") return;
		let cancelled = false;
		readShortcutsEnabled()
			.then((storedEnabled) => {
				if (!cancelled) setEnabledState(storedEnabled);
			})
			.catch((loadError) => {
				if (cancelled) return;
				setEnabledState(true);
				setError(loadError instanceof Error ? loadError.message : "Failed to load shortcut settings");
			})
			.finally(() => {
				if (!cancelled) setIsLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [cached]);

	const setEnabled = useCallback(async (next: boolean) => {
		const previous = enabled;
		setEnabledState(next);
		setError(null);
		try {
			const saved = await updateShortcutsEnabled(next);
			setEnabledState(saved);
			updateCachedSessionUser({ keyboardShortcutsEnabled: saved });
		} catch (updateError) {
			setEnabledState(previous);
			const message = updateError instanceof Error ? updateError.message : "Failed to update shortcut settings";
			setError(message);
			throw new Error(message);
		}
	}, [enabled]);

	return { enabled, error, isLoading, setEnabled };
}
