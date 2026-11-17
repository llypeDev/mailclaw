import { NextResponse } from "next/server";
import { aliasedTable, eq, desc, and, or, count, isNull, isNotNull, inArray, lte, gt, notInArray, ne, sql, sum } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { getEnv } from "@/lib/cloudflare";
import { getCurrentUser } from "@/lib/auth/cookies";
import { getDb } from "@/db";
import { messages, outboundJobs } from "@/db/schema";
import { getContactDisplayNameMap } from "@/lib/contacts/service";
import { getPartyDisplayName } from "@/lib/contacts/utils";
import { getFirstEmailAddressEntry, normalizeEmailAddress } from "@/lib/email/address";
import { getMailboxAccessLevel, hasMailboxPermission, listAccessibleMailboxes } from "@/lib/mailboxes/access";
import { tracksAccountIdentity } from "@/lib/profile/identity-utils";
import { buildSearchConditions } from "@/lib/search/conditions";
import { getRequestTimeZone } from "@/lib/time/utils";
import { scheduledMessageCondition } from "@/lib/email/scheduled";
import { countMessageList, getMessageListColumns, loadConversationPage, pageTotalWithoutCount, splitPageRows } from "./utils";
import type { ListMessage } from "./types";
import { getOpenCounts } from "@/lib/tracking/open-tracking";
import { summarizeNotesForRows } from "@/lib/notes/service";
import { isMissingTableError } from "@/lib/database-errors";
import { clampIntParam } from "@/lib/http/pagination";

export async function GET(request: Request) {
	const env = getEnv();
	const user = await getCurrentUser(env, request);
	if (!user) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const url = new URL(request.url);
	const direction = url.searchParams.get("direction");
	const mailboxId = url.searchParams.get("mailboxId");
	const folderId = url.searchParams.get("folderId");
	const status = url.searchParams.get("status");
	const query = url.searchParams.get("q")?.trim();
	const title = url.searchParams.get("title")?.trim();
	const read = url.searchParams.get("read");
	const starred = url.searchParams.get("starred");
	const snoozed = url.searchParams.get("snoozed");
	const scheduled = url.searchParams.get("scheduled");
	const limit = clampIntParam(url.searchParams.get("limit"), 50, 1, 100);
	const offset = clampIntParam(url.searchParams.get("offset"), 0, 0, Number.MAX_SAFE_INTEGER);
	// Conversation view: one row per thread, represented by its newest message
	// that matches the filter. Drafts are never grouped.
	const groupByThread = url.searchParams.get("group") === "thread" && status !== "draft";

	const db = getDb(env);
	const accessibleMailboxes = await listAccessibleMailboxes(db, user);
	const accessibleMailboxIds = accessibleMailboxes.map((mailbox) => mailbox.id);
	const conditions: SQL[] = [];
	if (mailboxId) {
		const mailbox = accessibleMailboxes.find((mailbox) => mailbox.id === mailboxId);
		// Reuse this request's authorization; retain the fallback for mailboxes
		// omitted by the list's domain join (for example, legacy orphaned rows).
		const canRead = mailbox
			? hasMailboxPermission(mailbox.permission, "read_only")
			: (await getMailboxAccessLevel(db, user, mailboxId))?.canRead;
		if (!canRead) {
			return NextResponse.json({ error: "Mailbox not found" }, { status: 404 });
		}
		conditions.push(eq(messages.mailboxId, mailboxId));
	} else if (accessibleMailboxIds.length > 0) {
		conditions.push(inArray(messages.mailboxId, accessibleMailboxIds));
	} else {
		conditions.push(eq(messages.userId, user.id));
	}
	if (direction === "inbound" || direction === "outbound") {
		conditions.push(eq(messages.direction, direction));
	}
	if (folderId) {
		conditions.push(eq(messages.folderId, folderId));
	}
	if (status) {
		conditions.push(eq(messages.status, status));
	}
	// Composer templates are stored as messages but never listed.
	if (status !== "template") {
		conditions.push(ne(messages.status, "template"));
	}
	if (status === "received" && !folderId) {
		conditions.push(isNull(messages.folderId));
		conditions.push(or(isNull(messages.snoozedUntil), lte(messages.snoozedUntil, new Date()))!);
	}
	if (starred === "true") {
		conditions.push(eq(messages.starred, true));
	}
	if (snoozed === "true") {
		conditions.push(eq(messages.status, "received"));
		conditions.push(isNull(messages.folderId));
		conditions.push(gt(messages.snoozedUntil, new Date()));
	}
	if (scheduled === "true") {
		conditions.push(scheduledMessageCondition(db));
	}
	if (read === "read") {
		conditions.push(eq(messages.read, true));
	}
	if (read === "unread") {
		conditions.push(eq(messages.read, false));
	}
	if (query || title) {
		// Operators (from:, has:attachment, before:) and free text go through the
		// full-text index; `title` is the legacy subject filter and is folded in.
		conditions.push(...buildSearchConditions(title ? `${query ?? ""} subject:"${title}"` : query ?? "", getRequestTimeZone(request, user.timeZone)));
	}
	const where = and(...conditions);
	// `count=only` answers just the total, which lists ask for separately so paging never waits on
	// (or repeats) a count over the whole folder.
	if (url.searchParams.get("count") === "only") {
		return NextResponse.json({ total: await countMessageList(db, where, groupByThread), grouped: groupByThread });
	}
	const accessibleMailboxIdSet = new Set(accessibleMailboxIds);
	// The same scope as the first condition above, for rows read by id alone.
	const inListScope = (row: { mailboxId: string | null; userId: string }) => mailboxId
		? row.mailboxId === mailboxId
		: accessibleMailboxIds.length > 0
			? !!row.mailboxId && accessibleMailboxIdSet.has(row.mailboxId)
			: row.userId === user.id;

	// The list renders `snippet`. Bodies stay on the thread endpoint.
	const messageListColumns = getMessageListColumns();

	// Null when only a full count could tell; the client then asks with `count=only`.
	let total: number | null = 0;
	let hasMore = false;
	let rows: ListMessage[];
	// Which stored messages each visible row stands for, so acting on a
	// conversation row acts on the whole conversation within this folder.
	const threadMessageIds = new Map<string, string[]>();
	// Unread messages per conversation within this folder; the row's unread state
	// has to match what marking it read will actually change.
	const scopedThreadCounts = new Map<string, { total: number; unread: number }>();
	if (groupByThread) {
		const page = await loadConversationPage({ db, where, offset, limit });
		total = page.total;
		hasMore = page.hasMore;
		// By primary key alone: the ids were just selected under `where`, and repeating it here lets
		// SQLite without statistics walk the folder's wide index instead. The scope is rechecked below.
		rows = page.ids.length
			? await db.select(messageListColumns).from(messages).where(inArray(messages.id, page.ids))
			: [];
		const rowById = new Map(rows.filter(inListScope).map((row) => [row.id, row]));
		rows = page.ids.map((id) => rowById.get(id)).filter((row): row is ListMessage => !!row);
		// A head without a thread id is its own conversation; other rows can still name it as thread.
		const keys = rows.map((row) => row.threadId ?? row.id);
		for (const row of rows) {
			if (row.threadId) continue;
			threadMessageIds.set(row.id, [row.id]);
			scopedThreadCounts.set(row.id, { total: 1, unread: row.read ? 0 : 1 });
		}
		if (keys.length > 0) {
			// Members come off the (mailbox_id, thread_id) index and each is checked against `where` by
			// primary key. Filtering on `where` directly lets SQLite without statistics prefer the
			// folder's covering index and scan the whole folder; selecting `user_id`, which no covering
			// index holds, keeps it on the thread index.
			const member = aliasedTable(messages, "thread_member");
			const memberScope = mailboxId
				? eq(member.mailboxId, mailboxId)
				: accessibleMailboxIds.length > 0
					? inArray(member.mailboxId, accessibleMailboxIds)
					: eq(member.userId, user.id);
			const members = await db
				.select({ id: member.id, threadId: member.threadId, read: member.read, userId: member.userId })
				.from(member)
				.where(and(
					memberScope,
					inArray(member.threadId, keys),
					sql`exists (select 1 from ${messages} where ${messages.id} = ${member.id} and ${where})`,
				));
			for (const row of members) {
				const key = row.threadId!;
				const list = threadMessageIds.get(key) ?? [];
				list.push(row.id);
				threadMessageIds.set(key, list);
				const counts = scopedThreadCounts.get(key) ?? { total: 0, unread: 0 };
				counts.total += 1;
				if (!row.read) counts.unread += 1;
				scopedThreadCounts.set(key, counts);
			}
		}
	} else {
		const pageRows = await db
			.select(messageListColumns)
			.from(messages)
			.where(where)
			.orderBy(desc(messages.createdAt))
			.limit(limit + 1)
			.offset(offset);
		const page = splitPageRows(pageRows, limit);
		rows = page.rows;
		hasMore = page.hasMore;
		// The full count runs only for an offset past the end, so the client can step back to the last page.
		total = pageTotalWithoutCount(offset, rows.length, hasMore) ?? (hasMore ? null : await countMessageList(db, where, false));
	}
	// Conversation sizes for the rows on this page, so the list can show "(3)"
	// next to a subject the way threaded clients do.
	const threadIds = Array.from(new Set(rows.map((row) => row.threadId).filter((id): id is string => !!id)));
	const scope = mailboxId
		? eq(messages.mailboxId, mailboxId)
		: accessibleMailboxIds.length > 0
			? inArray(messages.mailboxId, accessibleMailboxIds)
			: eq(messages.userId, user.id);
	// These enrichments depend only on the selected page, not on each other.
	const [countRows, jobs, openCounts, noteSummaries, contactMaps] = await Promise.all([
		threadIds.length > 0
			? db
				.select({
					threadId: messages.threadId,
					total: count(),
					unread: sum(sql`case when ${messages.read} then 0 else 1 end`),
				})
				.from(messages)
				.where(and(scope, inArray(messages.threadId, threadIds), isNotNull(messages.threadId), notInArray(messages.status, ["draft", "trash"])))
				.groupBy(messages.threadId)
			: [],
		scheduled === "true" && rows.length > 0
			? db
				.select({ messageId: outboundJobs.messageId, scheduledAt: outboundJobs.scheduledAt })
				.from(outboundJobs)
				.where(and(inArray(outboundJobs.messageId, rows.map((row) => row.id)), eq(outboundJobs.status, "queued"), isNotNull(outboundJobs.scheduledAt)))
			: [],
		getOpenCounts(env, rows.filter((row) => row.direction === "outbound").map((row) => row.id)),
		// Optional: a database without the notes migration has no notes to show.
		summarizeNotesForRows(db, rows).catch((error) => {
			if (isMissingTableError(error)) return new Map<string, { count: number; preview: string }>();
			throw error;
		}),
		Promise.all(
			Array.from(new Set(rows.map((message) => message.userId))).map(async (userId) => [
				userId,
				await getContactDisplayNameMap(
					env,
					userId,
					rows
						.filter((message) => message.userId === userId)
						.flatMap((message) => [message.fromAddr, getFirstEmailAddressEntry(message.toAddr)]),
				),
			] as const),
		),
	]);
	const threadCounts = new Map<string, { total: number; unread: number }>();
	for (const row of countRows) {
		if (row.threadId) threadCounts.set(row.threadId, { total: row.total, unread: Number(row.unread ?? 0) });
	}
	const scheduledAtByMessageId = new Map<string, string>();
	for (const job of jobs) {
		if (job.messageId && job.scheduledAt) scheduledAtByMessageId.set(job.messageId, job.scheduledAt.toISOString());
	}
	const mailboxNameMap = new Map(
		accessibleMailboxes.map((mailbox) => [
			mailbox.id,
			mailbox.userId === user.id && tracksAccountIdentity(mailbox, user.email)
				? user.name
				: mailbox.displayName ?? mailbox.localPart,
		]),
	);
	const contactMapsByUserId = new Map(contactMaps);
	// `Message.textBody`/`htmlBody` are optional on the wire type and the
	// reading pane loads them from /api/messages/[id]/thread, so they are
	// neither selected nor sent here.
	const enrichedRows = rows.map(({ rawR2Key: _rawR2Key, ...message }) => {
		const threadStats = message.threadId ? threadCounts.get(message.threadId) : undefined;
		const folderUnread = scopedThreadCounts.get(message.threadId ?? message.id)?.unread;
		const contactMap = contactMapsByUserId.get(message.userId);
		const accountName = message.mailboxId ? mailboxNameMap.get(message.mailboxId) : null;
		const firstTo = getFirstEmailAddressEntry(message.toAddr);
		return {
			...message,
			snippet: message.snippet,
			...(scheduledAtByMessageId.has(message.id) ? { scheduledAt: scheduledAtByMessageId.get(message.id) } : {}),
			...(openCounts.has(message.id) ? { openCount: openCounts.get(message.id) } : {}),
			...(noteSummaries.has(message.id) ? { noteCount: noteSummaries.get(message.id)!.count, notePreview: noteSummaries.get(message.id)!.preview } : {}),
			fromContactName:
				(message.direction === "outbound" ? accountName : null) ??
				getPartyDisplayName(message.fromAddr, contactMap?.get(normalizeEmailAddress(message.fromAddr))),
			toContactName: getPartyDisplayName(firstTo, contactMap?.get(normalizeEmailAddress(firstTo))),
			threadCount: threadStats?.total || 1,
			threadUnread: (groupByThread ? folderUnread : threadStats?.unread) || 0,
			...(groupByThread
				? { threadMessageIds: threadMessageIds.get(message.threadId ?? message.id) ?? [message.id] }
				: {}),
		};
	});

	return NextResponse.json({ messages: enrichedRows, total, hasMore, limit, offset, grouped: groupByThread });
}
