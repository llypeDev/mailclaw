import assert from "node:assert/strict";
import test, { after } from "node:test";
import { loadAppWithSqlite, recordingBucket, seconds, DAY_MS } from "./helpers/app-sqlite.mjs";

// Mail upkeep against a migrated SQLite database: the per-user Trash/Spam retention purge
// (src/lib/email/trash-retention.ts), the orphaned raw MIME sweep (raw-sweeper.ts) and the
// conversation a message belongs to (thread-view.ts). Nothing is stubbed but the bucket.
const app = await loadAppWithSqlite({
	name: "email-maintenance",
	exports: [
		`export { runTrashRetention } from "./src/lib/email/trash-retention.ts";`,
		`export { TRASH_RETENTION_BATCH_SIZE } from "./src/lib/email/trash-retention-utils.ts";`,
		`export { sweepOrphanedRawMail } from "./src/lib/email/raw-sweeper.ts";`,
		`export { RAW_SWEEP_STATE_KEY } from "./src/lib/email/raw-sweeper-utils.ts";`,
		`export { getMessageThreadForUser } from "./src/lib/email/thread-view.ts";`,
	],
});
after(app.dispose);
const lib = app.lib;

const NOW = new Date("2026-11-16T12:00:00Z");

/** recordingBucket plus R2's list (sorted keys, opaque cursor), get and per-object upload times. */
function listingBucket() {
	const bucket = recordingBucket();
	const uploaded = new Map();
	bucket.add = (key, date) => {
		bucket.objects.set(key, "raw");
		uploaded.set(key, date);
	};
	bucket.list = async ({ prefix = "", cursor, limit = 1000 }) => {
		const keys = [...bucket.objects.keys()].filter((key) => key.startsWith(prefix)).sort();
		const rest = cursor ? keys.filter((key) => key > cursor) : keys;
		const page = rest.slice(0, limit);
		const truncated = rest.length > limit;
		return { objects: page.map((key) => ({ key, uploaded: uploaded.get(key) ?? NOW })), truncated, cursor: truncated ? page.at(-1) : undefined };
	};
	bucket.get = async (key) => (bucket.objects.has(key) ? { text: async () => String(bucket.objects.get(key)) } : null);
	return bucket;
}

async function fixture(t) {
	const database = await app.openDatabase(t);
	const sql = database.db;
	const bucket = listingBucket();
	const env = { DB: database, BUCKET: bucket };
	const now = seconds(NOW);
	const addUser = (id, { retention = null, role = "user" } = {}) => {
		sql.prepare("INSERT INTO users (id, email, name, password_hash, role, trash_retention_days, created_at) VALUES (?, ?, ?, 'x', ?, ?, ?)")
			.run(id, `${id}@example.com`, id, role, retention, now);
		return { id, email: `${id}@example.com`, role };
	};
	const addMailbox = (id, userId, { type = "personal", disabled = false } = {}) => {
		sql.prepare("INSERT OR IGNORE INTO domains (id, user_id, hostname, zone_id, created_at) VALUES ('d1', ?, 'example.com', 'zone', ?)").run(userId, now);
		sql.prepare("INSERT INTO mailboxes (id, user_id, domain_id, local_part, type, disabled, created_at) VALUES (?, ?, 'd1', ?, ?, ?, ?)").run(id, userId, id, type, disabled ? 1 : 0, now);
	};
	let clock = now - 10_000;
	const addMessage = (id, userId, mailboxId, { status = "received", direction = "inbound", trashedDaysAgo = null, threadId = null, raw = `inbound/${id}`, from = "Anna <anna@example.org>", to = "Kevin <kevin@example.com>, bea@example.com", createdAt = (clock += 10) } = {}) => {
		sql.prepare(
			"INSERT INTO messages (id, user_id, mailbox_id, direction, from_addr, to_addr, subject, text_body, html_body, raw_r2_key, status, thread_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
		).run(id, userId, mailboxId, direction, from, to, `Subject ${id}`, `text ${id}`, `<p>${id}</p>`, raw, status, threadId, createdAt);
		// The insert trigger stamps trashed_at with the real clock; tests set it explicitly.
		if (trashedDaysAgo !== null) sql.prepare("UPDATE messages SET trashed_at = ? WHERE id = ?").run(seconds(new Date(NOW.getTime() - trashedDaysAgo * DAY_MS)), id);
	};
	const addAttachment = (id, messageId, { r2Key = `attachments/${id}`, trashed = false } = {}) => {
		sql.prepare("INSERT INTO message_attachments (id, message_id, filename, content_type, size, disposition, r2_key, trashed_at, created_at) VALUES (?, ?, ?, 'application/pdf', 10, 'attachment', ?, ?, ?)")
			.run(id, messageId, `${id}.pdf`, r2Key, trashed ? now : null, now);
	};
	const ids = (table, where = "1 = 1") => sql.prepare(`SELECT id FROM ${table} WHERE ${where} ORDER BY id`).all().map((row) => row.id);
	return { sql, env, bucket, addUser, addMailbox, addMessage, addAttachment, ids };
}

test("retention deletes Trash and Spam older than each owner's setting, with objects and audit rows", async (t) => {
	const f = await fixture(t);
	f.addUser("u1", { retention: 30 });
	f.addUser("u2");
	f.addUser("u3", { retention: 7 });
	f.addUser("u4", { retention: 0 });
	f.addUser("u5", { retention: 999 });
	for (const user of ["u1", "u2", "u3", "u4", "u5"]) f.addMailbox(`mb-${user}`, user);

	f.addMessage("oldTrash", "u1", "mb-u1", { status: "trash", trashedDaysAgo: 31 });
	f.addMessage("oldSpam", "u1", "mb-u1", { status: "spam", trashedDaysAgo: 45, raw: null });
	f.addMessage("boundary", "u1", "mb-u1", { status: "trash", trashedDaysAgo: 30 });
	f.addMessage("recentTrash", "u1", "mb-u1", { status: "trash", trashedDaysAgo: 29 });
	// trashed_at survives only for Trash and Spam; anything else is never purged.
	f.addMessage("restored", "u1", "mb-u1", { status: "received", trashedDaysAgo: 90 });
	f.addMessage("noRetention", "u2", "mb-u2", { status: "trash", trashedDaysAgo: 400 });
	f.addMessage("weekOld", "u3", "mb-u3", { status: "spam", trashedDaysAgo: 8 });
	f.addMessage("zeroDays", "u4", "mb-u4", { status: "trash", trashedDaysAgo: 400 });
	f.addMessage("outOfRange", "u5", "mb-u5", { status: "trash", trashedDaysAgo: 400 });
	f.addAttachment("att1", "oldTrash");
	f.addAttachment("att2", "recentTrash");

	assert.equal(await lib.runTrashRetention(f.env, NOW), 3);
	assert.deepEqual(f.ids("messages"), ["boundary", "noRetention", "outOfRange", "recentTrash", "restored", "zeroDays"]);
	assert.deepEqual(f.bucket.deleted.sort(), ["attachments/att1", "inbound/oldTrash", "inbound/weekOld"]);
	assert.deepEqual(f.ids("message_attachments"), ["att2"]);

	const audits = f.sql.prepare("SELECT actor_user_id, mailbox_id, message_id, action, metadata FROM audit_logs ORDER BY actor_user_id, metadata").all();
	assert.deepEqual(audits.map((row) => [row.actor_user_id, row.mailbox_id, row.message_id, row.action, JSON.parse(row.metadata)]), [
		["u1", "mb-u1", null, "email.delete", { permanent: true, source: "retention", messageId: "oldSpam", previousStatus: "spam" }],
		["u1", "mb-u1", null, "email.delete", { permanent: true, source: "retention", messageId: "oldTrash", previousStatus: "trash" }],
		["u3", "mb-u3", null, "email.delete", { permanent: true, source: "retention", messageId: "weekOld", previousStatus: "spam" }],
	]);

	assert.equal(await lib.runTrashRetention(f.env, NOW), 0, "nothing left to purge");
	assert.equal(await lib.runTrashRetention(f.env, new Date(NOW.getTime() + 2 * DAY_MS)), 2, "boundary and recentTrash come due later");
});

test("one run purges at most one batch, and the backlog drains over later runs", async (t) => {
	const f = await fixture(t);
	f.addUser("u1", { retention: 1 });
	f.addUser("u2", { retention: 1 });
	f.addMailbox("mb1", "u1");
	f.addMailbox("mb2", "u2");
	const backlog = lib.TRASH_RETENTION_BATCH_SIZE + 5;
	for (let n = 0; n < backlog; n += 1) f.addMessage(`a${String(n).padStart(4, "0")}`, "u1", "mb1", { status: "trash", trashedDaysAgo: 2 });
	f.addMessage("b1", "u2", "mb2", { status: "trash", trashedDaysAgo: 2 });

	const first = await lib.runTrashRetention(f.env, NOW);
	assert.equal(first, lib.TRASH_RETENTION_BATCH_SIZE);
	assert.equal(f.ids("messages").length, backlog + 1 - lib.TRASH_RETENTION_BATCH_SIZE);
	const second = await lib.runTrashRetention(f.env, NOW);
	assert.equal(second, 6);
	assert.deepEqual(f.ids("messages"), []);
	assert.equal(f.sql.prepare("SELECT count(*) AS n FROM audit_logs").get().n, backlog + 1);
});

test("the raw sweep deletes only unreferenced inbound MIME older than 30 days", async (t) => {
	const f = await fixture(t);
	f.addUser("u1");
	f.addMailbox("mb1", "u1");
	const daysAgo = (days) => new Date(NOW.getTime() - days * DAY_MS);
	// Enough old objects for two listing pages and several lookup batches.
	const orphans = [];
	for (let n = 0; n < 120; n += 1) {
		const key = `inbound/old-${String(n).padStart(3, "0")}`;
		f.bucket.add(key, daysAgo(40));
		if (n % 3 === 0) f.addMessage(`kept-${n}`, "u1", "mb1", { raw: key });
		else orphans.push(key);
	}
	f.bucket.add("inbound/young-orphan", daysAgo(10));
	f.bucket.add("inbound/exactly-30-days", daysAgo(30));
	f.bucket.add("imports/v2/old-import", daysAgo(400));
	f.bucket.add("attachments/old-attachment", daysAgo(400));

	assert.equal(await lib.sweepOrphanedRawMail(f.env, NOW), orphans.length);
	assert.deepEqual(f.bucket.deleted.sort(), orphans);
	const left = [...f.bucket.objects.keys()].filter((key) => key !== lib.RAW_SWEEP_STATE_KEY);
	assert.equal(left.length, 40 + 4);
	for (const key of ["inbound/young-orphan", "inbound/exactly-30-days", "imports/v2/old-import", "attachments/old-attachment"]) assert.ok(left.includes(key), key);
	assert.equal(JSON.parse(f.bucket.objects.get(lib.RAW_SWEEP_STATE_KEY)).cursor, null, "the whole prefix fit in one run");

	assert.equal(await lib.sweepOrphanedRawMail(f.env, NOW), 0);
	assert.equal(await lib.sweepOrphanedRawMail(f.env, new Date(NOW.getTime() + 21 * DAY_MS)), 2, "the young and boundary objects come due");
});

async function threadFixture(t) {
	const f = await fixture(t);
	const owner = f.addUser("u1");
	const member = f.addUser("u2");
	const stranger = f.addUser("u3", { role: "admin" });
	f.addMailbox("mb1", "u1");
	f.addMailbox("mb2", "u1");
	f.addMailbox("team", "u1", { type: "shared" });
	f.sql.prepare("INSERT INTO mailbox_access (id, mailbox_id, user_id, permission, created_at) VALUES ('acc', 'team', 'u2', 'read_only', 0)").run();
	f.sql.prepare("INSERT INTO contacts (id, user_id, email, display_name, source, avatar_key, created_at) VALUES ('c1', 'u1', 'anna@example.org', 'Anna Smith', 'manual', 'avatars/anna', 0)").run();

	f.addMessage("m1", "u1", "mb1", { threadId: "t1" });
	f.addMessage("m2", "u1", "mb1", { threadId: "t1", status: "sent", direction: "outbound", from: "kevin@example.com", to: "Anna <anna@example.org>" });
	f.addMessage("m3", "u1", "mb1", { threadId: "t1", status: "draft", direction: "outbound" });
	f.addMessage("m4", "u1", "mb1", { threadId: "t1", status: "trash" });
	f.addMessage("m5", "u1", "mb1", { threadId: "t1", status: "spam" });
	f.addMessage("m6", "u1", "mb1", { threadId: "t1", status: "archived" });
	f.addMessage("other", "u1", "mb2", { threadId: "t1" });
	f.addMessage("lonely", "u1", "mb1");
	f.addMessage("teamMail", "u1", "team", { threadId: "t9" });
	f.addAttachment("live", "m2");
	f.addAttachment("binned", "m2", { trashed: true });
	return { ...f, owner, member, stranger };
}

test("a thread lists the mailbox's messages oldest first, without drafts, trash or other spam", async (t) => {
	const f = await threadFixture(t);
	const thread = await lib.getMessageThreadForUser(f.env, f.owner, "m1");
	assert.equal(thread.threadId, "t1");
	assert.deepEqual(thread.messages.map((message) => message.id), ["m1", "m2", "m6"]);

	const [opened, reply] = thread.messages;
	assert.equal(opened.textBody, null, "the open message's body is not sent twice");
	assert.equal(opened.htmlBody, null);
	assert.equal(reply.textBody, "text m2");
	assert.equal(reply.htmlBody, "<p>m2</p>");
	assert.ok(thread.messages.every((message) => !("rawR2Key" in message)), "the R2 key never leaves the server");

	assert.equal(opened.fromContactName, "Anna Smith", "a manual contact's name wins");
	assert.equal(opened.fromContactHasAvatar, true);
	assert.equal(opened.toContactName, "Kevin", "the first recipient's display name");
	assert.equal(reply.toContactName, "Anna Smith");
	assert.equal(reply.fromContactHasAvatar, false);

	assert.deepEqual(reply.attachments.map((attachment) => [attachment.id, attachment.filename, attachment.type]), [["live", "live.pdf", "application/pdf"]]);
	assert.deepEqual(opened.attachments, []);
});

test("spam joins its thread only when it is the message being opened, and a message without a thread stands alone", async (t) => {
	const f = await threadFixture(t);
	assert.deepEqual((await lib.getMessageThreadForUser(f.env, f.owner, "m5")).messages.map((message) => message.id), ["m1", "m2", "m5", "m6"]);
	const lonely = await lib.getMessageThreadForUser(f.env, f.owner, "lonely");
	assert.equal(lonely.threadId, null);
	assert.deepEqual(lonely.messages.map((message) => [message.id, message.textBody]), [["lonely", null]]);
});

test("a thread is only returned to users who can read the mailbox", async (t) => {
	const f = await threadFixture(t);
	assert.equal(await lib.getMessageThreadForUser(f.env, f.member, "m1"), null, "a personal mailbox of someone else");
	assert.equal(await lib.getMessageThreadForUser(f.env, f.stranger, "m1"), null, "being an admin does not open other people's mail");
	assert.equal(await lib.getMessageThreadForUser(f.env, f.owner, "missing"), null);
	assert.deepEqual((await lib.getMessageThreadForUser(f.env, f.member, "teamMail")).messages.map((message) => message.id), ["teamMail"], "read-only sharing is enough");
	assert.equal(await lib.getMessageThreadForUser(f.env, f.stranger, "teamMail"), null);

	f.sql.prepare("UPDATE mailboxes SET disabled = 1 WHERE id = 'mb1'").run();
	assert.equal(await lib.getMessageThreadForUser(f.env, f.owner, "m1"), null, "a disabled mailbox");
	f.sql.prepare("UPDATE messages SET mailbox_id = NULL WHERE id = 'lonely'").run();
	assert.equal(await lib.getMessageThreadForUser(f.env, f.owner, "lonely"), null, "a message whose mailbox is gone");
});
