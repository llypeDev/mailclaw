import { NextResponse } from "next/server";
import { eq, desc, and, inArray } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { getEnv } from "@/lib/cloudflare";
import { authenticateApiKey, requireScope } from "@/lib/api/auth";
import { getDb } from "@/db";
import { messages } from "@/db/schema";
import { getMailboxAccessLevel, listAccessibleMailboxIds } from "@/lib/mailboxes/access";
import { buildSearchConditions } from "@/lib/search/conditions";
import { getRequestTimeZone } from "@/lib/time/utils";
import { clampIntParam } from "@/lib/http/pagination";

export async function GET(request: Request) {
	const env = getEnv();
	const auth = await authenticateApiKey(env, request.headers.get("authorization"));
	if (!auth || !requireScope(auth.scopes, "read")) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const url = new URL(request.url);
	const mailboxId = url.searchParams.get("mailboxId");
	const direction = url.searchParams.get("direction");
	const query = url.searchParams.get("q")?.trim();
	const limit = clampIntParam(url.searchParams.get("limit"), 50, 1, 100);

	const db = getDb(env);
	// Authentication already loaded the key's user and refused a disabled one.
	const { user } = auth;
	const conditions: SQL[] = [];
	if (mailboxId) {
		if (auth.mailboxIds && !auth.mailboxIds.includes(mailboxId)) {
			return NextResponse.json({ error: "Mailbox not found" }, { status: 404 });
		}
		const access = await getMailboxAccessLevel(db, user, mailboxId);
		if (!access?.canRead) {
			return NextResponse.json({ error: "Mailbox not found" }, { status: 404 });
		}
		conditions.push(eq(messages.mailboxId, mailboxId));
	} else {
		const accessibleMailboxIds = (await listAccessibleMailboxIds(db, user)).filter((id) => !auth.mailboxIds || auth.mailboxIds.includes(id));
		if (accessibleMailboxIds.length > 0) {
			conditions.push(inArray(messages.mailboxId, accessibleMailboxIds));
		} else if (auth.mailboxIds) {
			return NextResponse.json({ messages: [] });
		} else {
			conditions.push(eq(messages.userId, auth.userId));
		}
	}
	if (direction === "inbound" || direction === "outbound") {
		conditions.push(eq(messages.direction, direction));
	}
	if (query) conditions.push(...buildSearchConditions(query, getRequestTimeZone(request, user.timeZone)));

	const rows = await db
		.select()
		.from(messages)
		.where(and(...conditions))
		.orderBy(desc(messages.createdAt))
		.limit(limit);

	return NextResponse.json({ messages: rows });
}
