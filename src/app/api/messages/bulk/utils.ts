import { z } from "zod";
import type { BulkMessageAction, PermanentDeleteFolder } from "./types";

/** Largest bulk request body: 5,000 ids (the action limit) with room for long ones. */
export const BULK_BODY_MAX_BYTES = 512 * 1024;

/**
 * The shape of a bulk request. Which actions exist and how many ids are allowed are checked after
 * parsing, so those keep their specific error messages.
 */
export const bulkMessagePayloadSchema = z.object({
	messageIds: z.array(z.string().max(200)).optional(),
	action: z.string().optional(),
	folderId: z.string().max(200).nullish(),
});

const allowedBulkActions = new Set<BulkMessageAction>([
	"archive",
	"trash",
	"spam",
	"read",
	"unread",
	"inbox",
	"folder",
	"delete",
]);

export function isAllowedBulkMessageAction(action: unknown): action is BulkMessageAction {
	return typeof action === "string" && allowedBulkActions.has(action as BulkMessageAction);
}

export function getStatusForBulkAction(action: BulkMessageAction): string | null {
	if (action === "archive") return "archived";
	if (action === "trash") return "trash";
	if (action === "spam") return "spam";
	if (action === "inbox") return "received";
	if (action === "folder") return "received";
	return null;
}

export function getReadValueForBulkAction(action: BulkMessageAction): boolean | null {
	if (action === "read") return true;
	if (action === "unread") return false;
	return null;
}

/**
 * Permanent deletion is only offered for mail the user already threw away, so a
 * stray "delete" can never destroy something still in the inbox, a folder or Sent.
 */
export function isPermanentlyDeletableStatus(status: string | null | undefined): status is PermanentDeleteFolder {
	return status === "trash" || status === "spam";
}

export function isPermanentDeleteFolder(folder: unknown): folder is PermanentDeleteFolder {
	return folder === "trash" || folder === "spam";
}
