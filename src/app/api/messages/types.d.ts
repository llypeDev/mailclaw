import type { getTableColumns, SQL } from "drizzle-orm";
import type { AppDatabase } from "@/db";
import type { messages } from "@/db/schema";

export type ListMessage = Omit<typeof messages.$inferSelect, "textBody" | "htmlBody">;

export type MessageListColumns = Omit<ReturnType<typeof getTableColumns<typeof messages>>, "textBody" | "htmlBody">;

export type ConversationPageInput = {
	db: AppDatabase;
	where: SQL | undefined;
	offset: number;
	limit: number;
};

export type ConversationPage = {
	ids: string[];
	/** Whether another page of conversations follows this one. */
	hasMore: boolean;
	/** Conversations in the folder, when known without a count; see `pageTotalWithoutCount`. */
	total: number | null;
};
