import type { getTableColumns, SQL } from "drizzle-orm";
import type { AppDatabase } from "@/db";
import type { messages } from "@/db/schema";

export type ListMessage = Omit<typeof messages.$inferSelect, "textBody" | "htmlBody">;

export type MessageListColumns = Omit<ReturnType<typeof getTableColumns<typeof messages>>, "textBody" | "htmlBody">;

/** Where a keyset page starts: strictly after this sort key, in (created_at DESC, id DESC) order. */
export type ListCursor = {
	createdAt: Date;
	id: string;
};

export type ConversationPageInput = {
	db: AppDatabase;
	where: SQL | undefined;
	/** Conversations to skip; ignored for positioning when `cursor` is set. */
	offset: number;
	limit: number;
	/** Start after the conversation whose head has this sort key. */
	cursor?: ListCursor | null;
	/** Whether `where` is served by an index ordered by created_at (see `listPageBound`). */
	seek?: boolean;
	/**
	 * The list's mailbox scope applied to another alias of `messages`, so the
	 * cursor's "thread already listed" check seeks the thread key index.
	 */
	threadScope?: (table: typeof messages) => SQL;
};

export type ConversationPage = {
	ids: string[];
	/** Whether another page of conversations follows this one. */
	hasMore: boolean;
	/** Conversations in the folder, when known without a count; see `pageTotalWithoutCount`. */
	total: number | null;
	/** Where the next page starts, when `hasMore`. */
	nextCursor: string | null;
};

/** The filters of a list view that `message_counters` can answer (see `canCountFromCounters`). */
export type ListCountFilter = {
	direction: "inbound" | "outbound" | null;
	folderId: string | null;
	/** Null lists every status but `template`. */
	status: string | null;
	/** The Inbox: no folder, and messages snoozed right now are left out. */
	inbox: boolean;
	starred: boolean;
	read: boolean | null;
};

/** The columns of a message, or of a counted group of messages, that `ListCountFilter` looks at. */
export type ListCountRow = {
	folderId: string | null;
	direction: string;
	status: string;
	read: boolean;
	starred: boolean;
};
