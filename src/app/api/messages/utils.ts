import { aliasedTable, and, count, countDistinct, desc, eq, getTableColumns, gt, gte, inArray, lt, notExists, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { AppDatabase } from "@/db";
import { messages } from "@/db/schema";
import { isMissingTableError } from "@/lib/database-errors";
import { selectCounterRows } from "@/lib/messages/counters";
import { mergeCounterRows } from "@/lib/messages/counters-utils";
import { encodeListCursor, listPageBound } from "./list-cursor-utils";
import { countListFromTallies } from "./list-count-utils";
import type { ConversationPage, ConversationPageInput, ListCountFilter, ListCursor, MessageListColumns } from "./types";

export function getMessageListColumns(): MessageListColumns {
	return Object.fromEntries(
		Object.entries(getTableColumns(messages)).filter(([name]) => name !== "textBody" && name !== "htmlBody"),
	) as MessageListColumns;
}

/**
 * The list total when the page itself already proves it, so no count runs: a page that is not full
 * (no row past it) ends the list, and an empty first page is an empty list. `null` means only a count
 * can tell, which is the case for every page with more rows after it and for an offset past the end.
 */
export function pageTotalWithoutCount(offset: number, rowsOnPage: number, hasMore: boolean): number | null {
	if (hasMore) return null;
	if (rowsOnPage > 0 || offset === 0) return offset + rowsOnPage;
	return null;
}

/** Splits the extra row a page reads (limit + 1) off into `hasMore`. */
export function splitPageRows<T>(rows: T[], limit: number): { rows: T[]; hasMore: boolean } {
	return rows.length > limit ? { rows: rows.slice(0, limit), hasMore: true } : { rows, hasMore: false };
}

/** How many list rows match: messages, or conversations when grouped. Runs over the whole folder. */
export async function countMessageList(db: AppDatabase, where: SQL | undefined, grouped: boolean): Promise<number> {
	const threadKey = sql<string>`coalesce(${messages.threadId}, ${messages.id})`;
	const [row] = await db.select({ total: grouped ? countDistinct(threadKey) : count() }).from(messages).where(where);
	return Number(row?.total ?? 0);
}

/**
 * The list total from `message_counters` (migration 0089) instead of a count
 * over the folder: one row per tally key of the mailboxes, plus, for the
 * Inbox, the messages snoozed right now (a range on
 * messages_mailbox_snoozed_idx), read in one batch so both see one snapshot.
 * Null before the migration, so the caller counts instead.
 */
export async function countMessageListFromCounters(db: AppDatabase, mailboxIds: string[], filter: ListCountFilter): Promise<number | null> {
	if (mailboxIds.length === 0) return 0;
	try {
		if (!filter.inbox) return countListFromTallies(mergeCounterRows(await selectCounterRows(db, mailboxIds)), [], filter);
		const [stored, snoozed] = await db.batch([
			selectCounterRows(db, mailboxIds),
			db
				.select({
					folderId: messages.folderId,
					direction: messages.direction,
					status: messages.status,
					read: messages.read,
					starred: messages.starred,
				})
				.from(messages)
				.where(and(inArray(messages.mailboxId, mailboxIds), gt(messages.snoozedUntil, new Date()))),
		]);
		return countListFromTallies(mergeCounterRows(stored), snoozed, filter);
	} catch (error) {
		if (isMissingTableError(error)) return null;
		throw error;
	}
}

/** Messages of `table` at or above the cursor in (created_at DESC, id DESC) order. */
function atOrAboveCursor(table: typeof messages, cursor: ListCursor): SQL {
	return or(gt(table.createdAt, cursor.createdAt), and(eq(table.createdAt, cursor.createdAt), gte(table.id, cursor.id)))!;
}

/**
 * Select one newest matching message per thread before applying pagination. The total is reported only
 * when the walk proved it (`pageTotalWithoutCount`, or a scan that reached the end of the folder);
 * otherwise it is null and `hasMore` says whether a next page exists.
 *
 * With a cursor the page starts after the conversation the cursor names: a conversation belongs to
 * the page when its newest matching message sorts below the cursor, so a message below it whose
 * thread also has a matching message at or above it was already listed with that thread.
 */
export async function loadConversationPage(input: ConversationPageInput): Promise<ConversationPage> {
	const { db, where, offset, limit, cursor = null, seek = false, threadScope } = input;
	const threadKey = sql<string>`coalesce(${messages.threadId}, ${messages.id})`;
	// A cursor places the page; the offset is then only the caller's position.
	const skip = cursor ? 0 : offset;

	// A conversation sorts by its newest matching message, so the first page of
	// heads is just the first occurrence of each thread key while scanning
	// messages newest-first — an index-ordered walk instead of a window
	// function over the whole result set. Threads are usually a handful of
	// messages, so one or two small batches fill a page.
	// One head past the page tells whether another page exists.
	const needed = skip + limit + 1;
	// Constant bound: offset is client input, so the scan must never scale
	// with it. Deep pages also can't be satisfied by the scan at all (heads
	// can never outnumber fetched rows), so they take the windowed plan
	// directly.
	const SCAN_CAP = 10_000;
	if (needed > SCAN_CAP) {
		return loadConversationPageWindowed(input);
	}
	let alreadyListed: SQL | undefined;
	if (cursor) {
		const later = aliasedTable(messages, "later_in_thread");
		alreadyListed = notExists(
			db
				.select({ one: sql`1` })
				.from(later)
				.where(and(
					threadScope?.(later),
					eq(sql`coalesce(${later.threadId}, ${later.id})`, threadKey),
					atOrAboveCursor(later, cursor),
					sql`exists (select 1 from ${messages} where ${messages.id} = ${later.id} and ${where})`,
				)),
		);
	}
	const headIds: string[] = [];
	const headCreatedAt = new Map<string, Date>();
	const seen = new Set<string>();
	let fetched = 0;
	let exhausted = false;
	// Each batch continues after the last row of the previous one.
	let scanFrom = cursor;
	while (headIds.length < needed && !exhausted && fetched < SCAN_CAP) {
		const batch = Math.min(1000, Math.max(200, needed * 4));
		const rows = await db
			.select({ id: messages.id, key: threadKey, createdAt: messages.createdAt })
			.from(messages)
			.where(and(where, listPageBound(scanFrom, seek), alreadyListed))
			.orderBy(desc(messages.createdAt), desc(messages.id))
			.limit(batch);
		fetched += rows.length;
		if (rows.length < batch) exhausted = true;
		if (rows.length) scanFrom = rows[rows.length - 1];
		for (const row of rows) {
			if (seen.has(row.key)) continue;
			seen.add(row.key);
			headIds.push(row.id);
			headCreatedAt.set(row.id, row.createdAt);
		}
		// Threads averaging more than ~10 messages per head make the scan pay
		// ~10 rows per head — the windowed plan wins on that shape, so bail
		// early rather than discovering it at the cap.
		if (headIds.length < needed && headIds.length * 10 < fetched) {
			return loadConversationPageWindowed(input);
		}
	}
	// Only reachable on degenerate thread shapes; keep the old plan as the
	// correctness net rather than walking the table forever.
	if (!exhausted && headIds.length < needed) {
		return loadConversationPageWindowed(input);
	}
	const ids = headIds.slice(skip, skip + limit);
	const hasMore = headIds.length > skip + limit;
	const last = ids[ids.length - 1];
	const nextCursor = hasMore && last ? encodeListCursor({ id: last, createdAt: headCreatedAt.get(last)! }) : null;
	if (cursor) return { ids, hasMore, total: pageTotalWithoutCount(offset, ids.length, hasMore), nextCursor };
	// A walk that reached the end of the folder saw every conversation once.
	if (exhausted) return { ids, hasMore, total: headIds.length, nextCursor };
	return { ids, hasMore, total: null, nextCursor };
}

async function loadConversationPageWindowed({ db, where, offset, limit, cursor = null }: ConversationPageInput): Promise<ConversationPage> {
	const threadKey = sql<string>`coalesce(${messages.threadId}, ${messages.id})`;
	const ranked = db
		.select({
			id: messages.id,
			createdAt: messages.createdAt,
			position: sql<number>`row_number() over (partition by ${threadKey} order by ${messages.createdAt} desc, ${messages.id} desc)`.as("position"),
		})
		.from(messages)
		.where(where)
		.as("conversation_heads");

	// One query, even for deep pages or threads with many messages; the count only runs for an offset
	// past the end, where the caller needs the total to step back to the last page.
	const heads = await db
		.select({ id: ranked.id, createdAt: ranked.createdAt })
		.from(ranked)
		.where(cursor
			? and(
				eq(ranked.position, 1),
				or(lt(ranked.createdAt, cursor.createdAt), and(eq(ranked.createdAt, cursor.createdAt), lt(ranked.id, cursor.id))),
			)
			: eq(ranked.position, 1))
		.orderBy(desc(ranked.createdAt), desc(ranked.id))
		.limit(limit + 1)
		.offset(cursor ? 0 : offset);
	const page = splitPageRows(heads, limit);
	const ids = page.rows.map((head) => head.id);
	const last = page.rows[page.rows.length - 1];
	const nextCursor = page.hasMore && last ? encodeListCursor(last) : null;
	const total = pageTotalWithoutCount(offset, ids.length, page.hasMore)
		?? (page.hasMore || cursor ? null : await countMessageList(db, where, true));
	return { ids, hasMore: page.hasMore, total, nextCursor };
}
