/** A `message_counters` row as read, with whether the folder its key names still exists. */
export type StoredCounterRow = {
	mailboxId: string;
	folderKey: string;
	/** 1 when the folder named by `folderKey` exists. */
	folderExists: number | string;
	direction: "inbound" | "outbound";
	status: string;
	read: boolean;
	starred: boolean;
	total: number;
};

/** Messages of one mailbox sharing folder, direction, status, read and starred. */
export type CounterRow = {
	mailboxId: string;
	folderId: string | null;
	direction: "inbound" | "outbound";
	status: string;
	read: boolean;
	starred: boolean;
	total: number;
};
