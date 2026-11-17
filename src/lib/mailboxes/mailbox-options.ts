import type { AppDatabase } from "@/db";
import type { SessionUser } from "@/lib/auth/types";
import { ensurePersonalMailbox } from "@/app/api/mailboxes/utils";
import { getMailboxDomainAddresses } from "@/lib/mailboxes/domain-addresses";
import { tracksAccountIdentity } from "@/lib/profile/identity-utils";

/**
 * The `GET /api/mailboxes` body: every mailbox the user can open (creating the personal one on first
 * use), with the primary mailbox following the account name and avatar, and its sender addresses.
 */
export async function listMailboxOptions(
	env: CloudflareEnv,
	db: AppDatabase,
	user: SessionUser & { avatarKey?: string | null },
) {
	const rows = await ensurePersonalMailbox(env, db, user);
	return {
		mailboxes: await Promise.all(rows.map(async (mailbox) => ({
			...mailbox,
			...(mailbox.userId === user.id && tracksAccountIdentity(mailbox, user.email)
				? { displayName: user.name, hasAvatar: !!user.avatarKey }
				: {}),
			senderAddresses: await getMailboxDomainAddresses(db, mailbox),
		}))),
		canCreateShared: user.role === "admin",
	};
}
