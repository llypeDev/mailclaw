import assert from "node:assert/strict";
import test, { after } from "node:test";
import { loadAppWithSqlite, recordingBucket, seconds, DAY_MS } from "./helpers/app-sqlite.mjs";

// src/lib/accounts against a migrated SQLite database: who may delete or restore which account,
// the soft delete (disabled, signed out, restorable), handing Drive and calendar data to another
// account, and the scheduled purge after the 20-day window. Only Cloudflare routing is stubbed.
const state = { routing: [], failRouting: false };
globalThis.__accountsTest = state;
after(() => delete globalThis.__accountsTest);

const app = await loadAppWithSqlite({
	name: "accounts",
	exports: [
		`export * from "./src/lib/accounts/deletion.ts";`,
		`export * from "./src/lib/accounts/deletion-utils.ts";`,
	],
	mocks: {
		"@/lib/mailboxes/domain-addresses": `
			export async function removeMailboxDomainRouting(env, db, mailbox) {
				globalThis.__accountsTest.routing.push(mailbox.id);
				if (globalThis.__accountsTest.failRouting) throw new Error("Cloudflare API down");
			}
		`,
	},
});
after(app.dispose);
const lib = app.lib;

const primary = { id: "admin", role: "admin", isPrimaryAdmin: true, canManageUsers: true };
const manager = { id: "manager", role: "admin", isPrimaryAdmin: false, canManageUsers: true };
const plainAdmin = { id: "plain", role: "admin", isPrimaryAdmin: false, canManageUsers: false };

async function fixture(t) {
	state.routing = [];
	state.failRouting = false;
	const database = await app.openDatabase(t);
	const sql = database.db;
	const bucket = recordingBucket();
	const env = { DB: database, BUCKET: bucket };
	const now = seconds(new Date());
	const addUser = (id, { role = "user", isPrimaryAdmin = false, disabled = false, deletedAt = null, name = id, avatarKey = null } = {}) => {
		sql.prepare(
			"INSERT INTO users (id, email, name, password_hash, role, is_primary_admin, disabled, deleted_at, avatar_key, created_at) VALUES (?, ?, ?, 'x', ?, ?, ?, ?, ?, ?)",
		).run(id, `${id}@example.com`, name, role, isPrimaryAdmin ? 1 : 0, disabled ? 1 : 0, deletedAt ? seconds(deletedAt) : null, avatarKey, now);
	};
	addUser("admin", { role: "admin", isPrimaryAdmin: true });
	addUser("manager", { role: "admin" });
	addUser("plain", { role: "admin" });
	addUser("other-admin", { role: "admin" });
	addUser("alice", { name: "Alice" });
	addUser("bob", { name: "Bob" });
	addUser("carol");
	sql.prepare("INSERT INTO domains (id, user_id, hostname, zone_id, created_at) VALUES ('d1', 'admin', 'example.com', 'zone', ?)").run(now);
	const addSession = (id, userId) => sql.prepare("INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)").run(id, userId, `hash-${id}`, now + 3600, now);
	const user = (id) => sql.prepare("SELECT id, disabled, deleted_at FROM users WHERE id = ?").get(id);
	const count = (table, where = "1 = 1", ...params) => sql.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${where}`).get(...params).n;
	return { database, sql, bucket, env, now, addUser, addSession, user, count };
}

test("an account can be restored for 20 days, and its status says why it is inactive", () => {
	const deletedAt = new Date("2026-03-01T10:00:00Z");
	assert.equal(lib.ACCOUNT_RESTORE_DAYS, 20);
	assert.equal(lib.getAccountPurgeDate(deletedAt).toISOString(), "2026-03-21T10:00:00.000Z");
	assert.equal(lib.getAccountPurgeCutoff(new Date("2026-03-21T10:00:00Z")).toISOString(), deletedAt.toISOString());
	assert.equal(lib.getAccountStatus({ disabled: false }), "active");
	assert.equal(lib.getAccountStatus({ disabled: true, deletedAt: null }), "disabled");
	assert.equal(lib.getAccountStatus({ disabled: true, deletedAt: deletedAt }), "pendingDeletion");
	assert.equal(lib.getAccountStatus({ disabled: false, deletedAt: "2026-03-01" }), "pendingDeletion");
});

test("deleting accounts is refused for the wrong actor or target and changes nothing", async (t) => {
	const f = await fixture(t);
	f.addUser("gone", { disabled: true, deletedAt: new Date() });
	f.addSession("s-alice", "alice");
	const cases = [
		[plainAdmin, { ids: ["alice"] }, 403, "You do not have permission to manage users"],
		[{ ...primary, role: "user" }, { ids: ["alice"] }, 403, "You do not have permission to manage users"],
		[primary, { ids: [] }, 400, "Select at least one account"],
		[primary, { ids: ["alice", "nobody"] }, 404, "Account not found"],
		[manager, { ids: ["manager"] }, 400, "You cannot delete your own account"],
		[manager, { ids: ["admin"] }, 403, "The primary admin cannot be deleted"],
		[manager, { ids: ["alice", "other-admin"] }, 403, "Only the primary admin can manage admin accounts"],
		[primary, { ids: ["gone"] }, 409, "gone@example.com is already deleted"],
		[primary, { ids: ["alice"], transferToId: "alice" }, 400, "Choose an active account to transfer data to"],
		[primary, { ids: ["alice"], transferToId: "gone" }, 400, "Choose an active account to transfer data to"],
		[primary, { ids: ["alice"], transferToId: "nobody" }, 400, "Choose an active account to transfer data to"],
		[manager, { ids: ["alice"], transferToId: "other-admin" }, 403, "Only the primary admin can transfer data to an admin account"],
	];
	for (const [actor, input, status, error] of cases) {
		assert.deepEqual(await lib.deleteAccounts(f.env, actor, input), { ok: false, status, error }, `${actor.id} ${JSON.stringify(input)}`);
	}
	f.sql.prepare("UPDATE users SET disabled = 1 WHERE id = 'carol'").run();
	assert.equal((await lib.deleteAccounts(f.env, primary, { ids: ["alice"], transferToId: "carol" })).status, 400, "a disabled recipient");
	assert.deepEqual({ ...f.user("alice") }, { id: "alice", disabled: 0, deleted_at: null });
	assert.equal(f.count("sessions"), 1);
});

test("a deleted account is disabled and signed out but keeps its data until the purge", async (t) => {
	const f = await fixture(t);
	f.addSession("s-alice", "alice");
	f.addSession("s-bob", "bob");
	f.addSession("s-carol", "carol");
	f.sql.prepare("INSERT INTO mailboxes (id, user_id, domain_id, local_part, created_at) VALUES ('mb-alice', 'alice', 'd1', 'alice', 0)").run();

	const before = Date.now();
	assert.deepEqual(await lib.deleteAccounts(f.env, manager, { ids: ["alice", "bob", "alice"] }), { ok: true, deleted: 2 });
	for (const id of ["alice", "bob"]) {
		const row = f.user(id);
		assert.equal(row.disabled, 1);
		assert.ok(row.deleted_at * 1000 >= before - 1000);
	}
	assert.deepEqual(f.sql.prepare("SELECT id FROM sessions").all().map((row) => row.id), ["s-carol"]);
	assert.equal(f.count("mailboxes", "id = 'mb-alice'"), 1);
	assert.deepEqual(state.routing, [], "routing stays until the purge");
});

test("restoring is limited to deleted accounts the actor may manage", async (t) => {
	const f = await fixture(t);
	f.addUser("gone", { disabled: true, deletedAt: new Date() });
	f.addUser("gone-admin", { role: "admin", disabled: true, deletedAt: new Date() });
	assert.equal((await lib.restoreAccount(f.env, plainAdmin, "gone")).status, 403);
	assert.equal((await lib.restoreAccount(f.env, manager, "nobody")).status, 404);
	assert.deepEqual(await lib.restoreAccount(f.env, manager, "alice"), { ok: false, status: 409, error: "Account is not deleted" });
	assert.equal((await lib.restoreAccount(f.env, manager, "gone-admin")).status, 403);
	assert.deepEqual(await lib.restoreAccount(f.env, manager, "gone"), { ok: true, deleted: 0 });
	assert.deepEqual({ ...f.user("gone") }, { id: "gone", disabled: 0, deleted_at: null });
	assert.deepEqual(await lib.restoreAccount(f.env, primary, "gone-admin"), { ok: true, deleted: 0 });
});

test("a transfer moves Drive files into a folder for the recipient and hands over calendar events", async (t) => {
	const f = await fixture(t);
	const insertItem = f.sql.prepare(
		"INSERT INTO drive_items (id, owner_id, parent_id, kind, name, r2_key, upload_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0)",
	);
	insertItem.run("folder", "bob", null, "folder", "Projects", null, null);
	insertItem.run("nested", "bob", "folder", "file", "plan.pdf", null, null);
	insertItem.run("top", "bob", null, "file", "notes.txt", null, null);
	insertItem.run("keyed", "bob", null, "file", "saved.pdf", "attachments/a1", null);
	insertItem.run("uploading", "bob", null, "file", "big.iso", "drive/bob/uploading", "upload-1");
	insertItem.run("carols", "carol", null, "file", "mine.txt", null, null);
	f.sql.prepare("INSERT INTO calendar_events (id, user_id, title, starts_at, ends_at, created_at, updated_at) VALUES ('ev', 'bob', 'Review', 0, 3600, 0, 0)").run();

	assert.deepEqual(await lib.deleteAccounts(f.env, primary, { ids: ["bob"], transferToId: "carol" }), { ok: true, deleted: 1 });

	const handover = f.sql.prepare("SELECT * FROM drive_items WHERE owner_id = 'carol' AND kind = 'folder'").get();
	assert.equal(handover.name, "Files from Bob");
	assert.equal(handover.parent_id, null);
	const rows = Object.fromEntries(f.sql.prepare("SELECT id, owner_id, parent_id, r2_key FROM drive_items WHERE id != ?").all(handover.id).map((row) => [row.id, { ...row, id: undefined }]));
	assert.deepEqual(rows, {
		folder: { id: undefined, owner_id: "carol", parent_id: handover.id, r2_key: null },
		nested: { id: undefined, owner_id: "carol", parent_id: "folder", r2_key: "drive/bob/nested" },
		top: { id: undefined, owner_id: "carol", parent_id: handover.id, r2_key: "drive/bob/top" },
		keyed: { id: undefined, owner_id: "carol", parent_id: handover.id, r2_key: "attachments/a1" },
		// An unfinished upload stays where it was, with its owner, and is purged with the account.
		uploading: { id: undefined, owner_id: "bob", parent_id: null, r2_key: "drive/bob/uploading" },
		carols: { id: undefined, owner_id: "carol", parent_id: null, r2_key: null },
	});
	assert.equal(f.sql.prepare("SELECT user_id FROM calendar_events WHERE id = 'ev'").get().user_id, "carol");

	// The deleting admin may hand data to themselves.
	assert.deepEqual(await lib.deleteAccounts(f.env, manager, { ids: ["alice"], transferToId: "manager" }), { ok: true, deleted: 1 });
});

test("the purge removes accounts past the restore window with their mail, files and avatar", async (t) => {
	const f = await fixture(t);
	const now = new Date("2026-06-01T00:00:00Z");
	f.addUser("expired", { disabled: true, deletedAt: new Date(now.getTime() - 21 * DAY_MS) });
	f.addUser("edge", { disabled: true, deletedAt: new Date(now.getTime() - 20 * DAY_MS), avatarKey: "avatars/custom-edge" });
	f.addUser("pending", { disabled: true, deletedAt: new Date(now.getTime() - 19 * DAY_MS) });
	f.sql.prepare("INSERT INTO mailboxes (id, user_id, domain_id, local_part, created_at) VALUES ('mb-expired', 'expired', 'd1', 'expired', 0)").run();
	f.sql.prepare("INSERT INTO mailboxes (id, user_id, domain_id, local_part, created_at) VALUES ('mb-pending', 'pending', 'd1', 'pending', 0)").run();
	const insertMessage = f.sql.prepare("INSERT INTO messages (id, mailbox_id, user_id, direction, from_addr, to_addr, subject, status, raw_r2_key, created_at) VALUES (?, ?, ?, 'inbound', 'a@example.org', 'b@example.com', 's', 'received', ?, 0)");
	insertMessage.run("m1", "mb-expired", "expired", "raw/m1.eml");
	insertMessage.run("m2", "mb-expired", "expired", null);
	insertMessage.run("m3", "mb-pending", "pending", "raw/m3.eml");
	const insertAttachment = f.sql.prepare("INSERT INTO message_attachments (id, message_id, filename, content_type, size, r2_key, created_at) VALUES (?, ?, 'f', 'application/pdf', 1, ?, 0)");
	insertAttachment.run("a1", "m1", "attachments/a1");
	insertAttachment.run("a2", "m1", "attachments/saved-by-carol");
	f.sql.prepare("INSERT INTO drive_items (id, owner_id, parent_id, kind, name, r2_key, created_at, updated_at) VALUES ('carol-copy', 'carol', NULL, 'file', 'saved', 'attachments/saved-by-carol', 0, 0)").run();
	f.sql.prepare("INSERT INTO drive_items (id, owner_id, parent_id, kind, name, r2_key, created_at, updated_at) VALUES ('dir', 'expired', NULL, 'folder', 'd', NULL, 0, 0)").run();
	f.sql.prepare("INSERT INTO drive_items (id, owner_id, parent_id, kind, name, r2_key, created_at, updated_at) VALUES ('doc', 'expired', 'dir', 'file', 'x', NULL, 0, 0)").run();
	state.failRouting = true;
	const logged = t.mock.method(console, "error", () => {});

	assert.equal(await lib.runAccountRetention(f.env, now), 2);
	assert.equal(logged.mock.calls[0].arguments[0], "Account purge: could not remove routing");

	assert.equal(f.count("users", "id IN ('expired', 'edge')"), 0);
	assert.equal(f.count("users", "id = 'pending'"), 1);
	assert.deepEqual(state.routing, ["mb-expired"], "a routing failure is logged, not fatal");
	assert.equal(f.count("mailboxes", "id = 'mb-expired'"), 0);
	assert.equal(f.count("messages", "mailbox_id = 'mb-expired'"), 0);
	assert.equal(f.count("drive_items", "owner_id = 'expired'"), 0);
	assert.deepEqual(f.bucket.deleted.sort(), ["attachments/a1", "avatars/custom-edge", "avatars/expired", "drive/expired/doc", "raw/m1.eml"]);
	assert.equal(f.count("drive_items", "id = 'carol-copy'"), 1);
	assert.equal(await lib.runAccountRetention(f.env, now), 0);
});

test("one failing purge does not stop the others", async (t) => {
	const f = await fixture(t);
	const now = new Date("2026-06-01T00:00:00Z");
	f.addUser("broken", { disabled: true, deletedAt: new Date(now.getTime() - 30 * DAY_MS), avatarKey: "avatars/broken" });
	f.addUser("fine", { disabled: true, deletedAt: new Date(now.getTime() - 30 * DAY_MS) });
	const remove = f.bucket.delete;
	f.bucket.delete = async (keys) => {
		if ([keys].flat().includes("avatars/broken")) throw new Error("bucket unavailable");
		return remove(keys);
	};
	const logged = t.mock.method(console, "error", () => {});
	assert.equal(await lib.runAccountRetention(f.env, now), 1);
	assert.deepEqual(logged.mock.calls.map((call) => call.arguments[0]), ["Account purge failed"]);
	assert.equal(f.count("users", "id = 'broken'"), 1, "kept for the next daily run");
	assert.equal(f.count("users", "id = 'fine'"), 0);
});
