import { count, countDistinct, desc, eq, getTableColumns, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { AppDatabase } from "@/db";
import { messages } from "@/db/schema";
import type { ConversationPage, ConversationPageInput, MessageListColumns } from "./types";

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
 * Select one newest matching message per thread before applying pagination. The total is reported only
 * when the walk proved it (`pageTotalWithoutCount`, or a scan that reached the end of the folder);
 * otherwise it is null and `hasMore` says whether a next page exists.
 */
export async function loadConversationPage({ db, where, offset, limit }: ConversationPageInput): Promise<ConversationPage> {
	const threadKey = sql<string>`coalesce(${messages.threadId}, ${messages.id})`;

	// A conversation sorts by its newest matching message, so the first page of
	// heads is just the first occurrence of each thread key while scanning
	// messages newest-first — an index-ordered walk instead of a window
	// function over the whole result set. Threads are usually a handful of
	// messages, so one or two small batches fill a page.
	// One head past the page tells whether another page exists.
	const needed = offset + limit + 1;
	// Constant bound: offset is client input, so the scan must never scale
	// with it. Deep pages also can't be satisfied by the scan at all (heads
	// can never outnumber fetched rows), so they take the windowed plan
	// directly.
	const SCAN_CAP = 10_000;
	if (needed > SCAN_CAP) {
		return loadConversationPageWindowed({ db, where, offset, limit });
	}
	const headIds: string[] = [];
	const seen = new Set<string>();
	let fetched = 0;
	let exhausted = false;
	while (headIds.length < needed && !exhausted && fetched < SCAN_CAP) {
		const batch = Math.min(1000, Math.max(200, needed * 4));
		const rows = await db
			.select({ id: messages.id, key: threadKey })
			.from(messages)
			.where(where)
			.orderBy(desc(messages.createdAt), desc(messages.id))
			.limit(batch)
			.offset(fetched);
		fetched += rows.length;
		if (rows.length < batch) exhausted = true;
		for (const row of rows) {
			if (seen.has(row.key)) continue;
			seen.add(row.key);
			headIds.push(row.id);
		}
		// Threads averaging more than ~10 messages per head make the scan pay
		// ~10 rows per head — the windowed plan wins on that shape, so bail
		// early rather than discovering it at the cap.
		if (headIds.length < needed && headIds.length * 10 < fetched) {
			return loadConversationPageWindowed({ db, where, offset, limit });
		}
	}
	// Only reachable on degenerate thread shapes; keep the old plan as the
	// correctness net rather than walking the table forever.
	if (!exhausted && headIds.length < needed) {
		return loadConversationPageWindowed({ db, where, offset, limit });
	}
	const ids = headIds.slice(offset, offset + limit);
	const hasMore = headIds.length > offset + limit;
	// A walk that reached the end of the folder saw every conversation once.
	if (exhausted) return { ids, hasMore, total: headIds.length };
	return { ids, hasMore, total: null };
}

async function loadConversationPageWindowed({ db, where, offset, limit }: ConversationPageInput): Promise<ConversationPage> {
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
		.select({ id: ranked.id })
		.from(ranked)
		.where(eq(ranked.position, 1))
		.orderBy(desc(ranked.createdAt), desc(ranked.id))
		.limit(limit + 1)
		.offset(offset);
	const page = splitPageRows(heads, limit);
	const ids = page.rows.map((head) => head.id);
	const total = pageTotalWithoutCount(offset, ids.length, page.hasMore)
		?? (page.hasMore ? null : await countMessageList(db, where, true));
	return { ids, hasMore: page.hasMore, total };
}
