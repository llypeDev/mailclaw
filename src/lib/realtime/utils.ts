import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { domains, mailboxAccess, mailboxes } from "@/db/schema";
import type { NewMessageNotification, AgentDraftNotification } from "./types";
import { sendPushNotifications } from "@/lib/push/server";
import { sendNativePush } from "@/lib/push/native";

export function getSessionTokenFromRequest(request: Request): string | undefined {
	const cookie = request.headers.get("Cookie");
	if (!cookie) return undefined;

	for (const part of cookie.split(";")) {
		const [name, ...valueParts] = part.trim().split("=");
		if (name === "ep_session") {
			const value = valueParts.join("=");
			return value ? decodeURIComponent(value) : undefined;
		}
	}

	return undefined;
}

/**
 * Who hears about new mail in a mailbox: its owner, the owner of its domain and, for a shared
 * mailbox, everyone it is shared with. Pure, so a caller that already loaded the mailbox row and
 * its access list (the inbound consumer does, in one batch) spends no query on it.
 */
export function mailboxNotificationUserIds(
	ownerUserId: string,
	mailbox: { domainOwnerUserId: string | null; type: string } | null | undefined,
	accessUserIds: readonly string[],
): string[] {
	return [
		...new Set([
			ownerUserId,
			mailbox?.domainOwnerUserId,
			...(mailbox?.type === "shared" ? accessUserIds : []),
		].filter((userId): userId is string => !!userId)),
	];
}

/** One query: the mailbox, its domain and its access rows, joined. */
export async function getMailboxNotificationUserIds(
	env: CloudflareEnv,
	mailboxId: string,
	ownerUserId: string,
): Promise<string[]> {
	const rows = await getDb(env)
		.select({ domainOwnerUserId: domains.userId, type: mailboxes.type, accessUserId: mailboxAccess.userId })
		.from(mailboxes)
		.innerJoin(domains, eq(mailboxes.domainId, domains.id))
		.leftJoin(mailboxAccess, eq(mailboxAccess.mailboxId, mailboxes.id))
		.where(eq(mailboxes.id, mailboxId));
	return mailboxNotificationUserIds(
		ownerUserId,
		rows[0],
		rows.map((row) => row.accessUserId).filter((userId): userId is string => !!userId),
	);
}

export async function notifyUsersOfNewMessage(
	env: CloudflareEnv,
	userIds: string[],
	payload: NewMessageNotification | AgentDraftNotification,
): Promise<void> {
	// Next dev uses a bindings-only proxy; realtime delivery runs in worker.ts.
	if (!env.REALTIME) return;
	const results = await Promise.allSettled([
		...userIds.map((userId) => {
			const hub = env.REALTIME.getByName(userId);
			return hub.fetch("https://mailclaw-realtime/notify", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
			});
		}),
		...(payload.type === "agent_draft" ? [] : [sendPushNotifications(env, userIds, payload), sendNativePush(env, userIds, payload)]),
	]);
	for (const result of results) {
		if (result.status === "rejected") console.error("New-message notification failed", result.reason);
	}
}
