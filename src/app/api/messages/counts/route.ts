import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { getCurrentUser } from "@/lib/auth/cookies";
import { getEnv } from "@/lib/cloudflare";
import { loadMessageCounts, type MessageCountScope } from "./load";
import { getMailboxAccessLevel, listAccessibleMailboxIds } from "@/lib/mailboxes/access";

export async function GET(request: Request) {
	const env = getEnv();
	const user = await getCurrentUser(env, request);
	if (!user) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const url = new URL(request.url);
	const mailboxId = url.searchParams.get("mailboxId");
	const db = getDb(env);
	let scope: MessageCountScope;

	if (mailboxId) {
		const access = await getMailboxAccessLevel(db, user, mailboxId);
		if (!access?.canRead) {
			return NextResponse.json({ error: "Mailbox not found" }, { status: 404 });
		}
		scope = { mailboxIds: [mailboxId] };
	} else {
		const accessibleMailboxIds = await listAccessibleMailboxIds(db, user);
		scope = accessibleMailboxIds.length > 0 ? { mailboxIds: accessibleMailboxIds } : { userId: user.id };
	}

	const counts = await loadMessageCounts(db, scope);
	return NextResponse.json({ counts });
}
