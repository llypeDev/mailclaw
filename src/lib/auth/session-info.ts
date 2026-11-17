import type { getCurrentUser } from "@/lib/auth/cookies";
import { hasPrimaryDomain, userHasMailboxes } from "@/lib/user";
import { hasCloudflareCredentials, isNodeRuntime } from "@/lib/runtime";

export type SignedInUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

/** The `/api/auth/me` body, shared with `/api/bootstrap` so both answer the same session shape. */
export async function buildSessionInfo(env: CloudflareEnv, user: SignedInUser) {
	// Authentication remains valid when optional mailbox/setup metadata is unavailable.
	const [hasMailboxes, isSetup] = await Promise.all([
		userHasMailboxes(env, user.id),
		hasPrimaryDomain(env),
	]).catch((): [boolean, boolean] => [false, true]);
	return {
		user: {
			id: user.id,
			email: user.email,
			name: user.name,
			timeZone: user.timeZone,
			resetEmail: user.resetEmail,
			forwardingEmail: user.forwardingEmail,
			canForwardEmail: true,
			role: user.role,
			isPrimaryAdmin: user.isPrimaryAdmin,
			canManageMailboxes: user.canManageMailboxes,
			canManageDomains: user.canManageDomains,
			canManageUsers: user.canManageUsers,
			calendarEnabled: user.calendarEnabled,
			driveEnabled: user.driveEnabled,
			keyboardShortcutsEnabled: user.keyboardShortcutsEnabled,
			spamProtectionEnabled: user.spamProtectionEnabled,
			showFullRecipientAddresses: user.showFullRecipientAddresses,
			hasAvatar: !!user.avatarKey,
			mfaEnabled: user.totpEnabled,
		},
		runtime: isNodeRuntime(env) ? "node" : "cloudflare",
		managesDns: hasCloudflareCredentials(env),
		hasMailboxes,
		isSetup,
	};
}
