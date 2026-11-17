import { authFetch, clearClientSessionToken, markClientSessionActive } from "@/lib/auth/client";
import { setAppBadgeCount } from "@/lib/push/app-badge";

/** Returns true when another signed-in account on this browser took over. */
export async function logoutClientSession(): Promise<boolean> {
	let switched = false;
	try {
		const response = await authFetch("/api/auth/logout", {
			method: "POST",
			redirectOnUnauthorized: false,
		});
		const data = (await response.json().catch(() => null)) as { authenticated?: unknown; token?: unknown } | null;
		// The next account's session is already in the httpOnly cookie.
		switched = response.ok && (data?.authenticated === true || typeof data?.token === "string");
	} catch {
		// Local logout must complete even when the server request is unavailable.
	} finally {
		clearClientSessionToken();
		setAppBadgeCount(0);
	}
	if (!switched) return false;
	markClientSessionActive();
	return true;
}
