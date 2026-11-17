import assert from "node:assert/strict";
import test, { after } from "node:test";
import { loadAppWithSqlite, recordingBucket, seconds, DAY_MS } from "./helpers/app-sqlite.mjs";

// src/lib/drive against a migrated SQLite database: name and size rules, the type categories as
// SQL, roles inherited through shared ancestors, public links, permanent deletion that keeps
// objects shared with email attachments, the 30-day trash purge, the storage quota and the
// upload route that enforces it. Only the session lookup and getEnv() are stubbed.
const state = { env: null, user: null };
globalThis.__driveTest = state;
after(() => delete globalThis.__driveTest);

const app = await loadAppWithSqlite({
	name: "drive",
	exports: [
		`export * from "./src/lib/drive/utils.ts";`,
		`export { DRIVE_CATEGORIES, isDriveCategory, parseDriveCategories, driveCategoryCondition, driveTypesCondition } from "./src/lib/drive/categories.ts";`,
		`export * from "./src/lib/drive/access.ts";`,
		`export * from "./src/lib/drive/shared-objects.ts";`,
		`export * from "./src/lib/drive/retention.ts";`,
		`export * from "./src/lib/drive/storage.ts";`,
		`export { listDriveAttachments } from "./src/lib/drive/attachments.ts";`,
		`export { driveAccessError } from "./src/lib/drive/auth.ts";`,
		`export { POST as startUpload } from "./src/app/api/drive/upload/route.ts";`,
		`export { getDb } from "./src/db/index.ts";`,
		`export { driveItems } from "./src/db/schema/index.ts";`,
	],
	mocks: {
		"@/lib/cloudflare": "export function getEnv() { return globalThis.__driveTest.env; }",
		"@/lib/auth/cookies": "export async function getCurrentUser() { return globalThis.__driveTest.user; }",
	},
});
after(app.dispose);
const lib = app.lib;

async function fixture(t) {
	const database = await app.openDatabase(t);
	const sql = database.db;
	const bucket = recordingBucket();
	const env = { DB: database, BUCKET: bucket };
	state.env = env;
	state.user = null;
	const db = lib.getDb(env);
	const now = seconds(new Date());

	const addUser = (id, { name = id, driveEnabled = true, avatarKey = null } = {}) => {
		sql.prepare("INSERT INTO users (id, email, name, password_hash, drive_enabled, avatar_key, created_at) VALUES (?, ?, ?, 'x', ?, ?, ?)")
			.run(id, `${id}@example.com`, name, driveEnabled ? 1 : 0, avatarKey, now);
		return { id, email: `${id}@example.com`, role: "user", driveEnabled };
	};
	const addItem = (id, ownerId, { parentId = null, kind = "file", name = id, size = 0, contentType = "application/octet-stream", r2Key = null, trashedAt = null, linkToken = null, uploadId = null } = {}) => {
		sql.prepare(
			"INSERT INTO drive_items (id, owner_id, parent_id, kind, name, r2_key, size, content_type, upload_id, link_token, trashed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
		).run(id, ownerId, parentId, kind, name, r2Key, size, contentType, uploadId, linkToken, trashedAt ? seconds(trashedAt) : null, now, now);
	};
	const share = (itemId, userId, role) => {
		sql.prepare("INSERT INTO drive_shares (id, item_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)").run(`${itemId}-${userId}`, itemId, userId, role, now);
	};
	const addMailbox = (id, userId, { type = "personal", localPart = id } = {}) => {
		sql.prepare("INSERT OR IGNORE INTO domains (id, user_id, hostname, zone_id, created_at) VALUES ('d1', ?, 'example.com', 'zone', ?)").run(userId, now);
		sql.prepare("INSERT INTO mailboxes (id, user_id, domain_id, local_part, type, created_at) VALUES (?, ?, 'd1', ?, ?, ?)").run(id, userId, localPart, type, now);
	};
	let messageClock = now - 1000;
	const addMessage = (id, mailboxId, userId, { status = "received", direction = "inbound", from = "\"Anna\" <anna@example.org>", createdAt = (messageClock += 10) } = {}) => {
		sql.prepare(
			"INSERT INTO messages (id, mailbox_id, user_id, direction, from_addr, to_addr, subject, status, created_at) VALUES (?, ?, ?, ?, ?, 'kevin@example.com', ?, ?, ?)",
		).run(id, mailboxId, userId, direction, from, `Subject ${id}`, status, createdAt);
	};
	const addAttachment = (id, messageId, { filename = `${id}.pdf`, contentType = "application/pdf", disposition = "attachment", r2Key = `attachments/${id}`, trashedAt = null, size = 10 } = {}) => {
		sql.prepare(
			"INSERT INTO message_attachments (id, message_id, filename, content_type, size, disposition, r2_key, trashed_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
		).run(id, messageId, filename, contentType, size, disposition, r2Key, trashedAt ? seconds(trashedAt) : null, now);
	};
	const ids = (table) => sql.prepare(`SELECT id FROM ${table} ORDER BY id`).all().map((row) => row.id);
	const item = async (id) => lib.getDriveItem(db, id);
	return { database, sql, bucket, env, db, addUser, addItem, share, addMailbox, addMessage, addAttachment, ids, item };
}

test("names lose separators and control characters, keep 255 characters and refuse dot names", () => {
	assert.equal(lib.normalizeDriveName("  a/b\\c\u0001d \t e  "), "a b c d e");
	assert.equal(lib.normalizeDriveName("x".repeat(300)).length, lib.DRIVE_MAX_NAME_LENGTH);
	for (const value of [".", "..", "  ", "/", 5, null, undefined]) assert.equal(lib.normalizeDriveName(value), null, String(value));
	assert.equal(lib.normalizeDriveName("..."), "...");
});

test("roles, object keys, sizes and download headers", () => {
	assert.equal(lib.canEditDrive("owner"), true);
	assert.equal(lib.canEditDrive("edit"), true);
	assert.equal(lib.canEditDrive("view"), false);
	assert.equal(lib.canEditDrive(null), false);
	assert.equal(lib.driveObjectKey("u1", "item"), "drive/u1/item");
	assert.equal(lib.DRIVE_MAX_FILE_BYTES, lib.DRIVE_PART_BYTES * lib.DRIVE_MAX_PARTS);
	assert.equal(lib.formatDriveSize(0), "0 B");
	assert.equal(lib.formatDriveSize(1023), "1023 B");
	assert.equal(lib.formatDriveSize(1024), "1.0 KB");
	assert.equal(lib.formatDriveSize(1.5 * 1024 * 1024), "1.5 MB");
	assert.equal(lib.formatDriveSize(12 * 1024 ** 3), "12 GB");
	assert.equal(lib.formatDriveSize(2048 * 1024 ** 4), "2048 TB");
	assert.equal(
		lib.driveContentDisposition("résumé \"x\".pdf", true),
		"inline; filename=\"r_sum_ _x_.pdf\"; filename*=UTF-8''r%C3%A9sum%C3%A9%20%22x%22.pdf",
	);
	assert.match(lib.driveContentDisposition("a.txt", false), /^attachment; filename="a\.txt"/);
	assert.deepEqual(lib.toDriveCrumbs([{ id: "a", name: "A", ownerId: "u" }]), [{ id: "a", name: "A" }]);
});

test("type categories parse from the query string and select files by type or extension", async (t) => {
	assert.deepEqual(lib.parseDriveCategories("photos,bogus,videos,photos"), ["photos", "videos"]);
	assert.deepEqual(lib.parseDriveCategories(null), []);
	assert.equal(lib.isDriveCategory("others"), true);
	assert.equal(lib.isDriveCategory("music"), false);

	const f = await fixture(t);
	f.addUser("u1");
	const files = {
		"a.jpg": "image/jpeg",
		"B.HEIC": "application/octet-stream",
		"c.svg": "image/svg+xml",
		"d.mp4": "video/mp4",
		"e.md": "application/octet-stream",
		"f.pdf": "application/pdf",
		"g.zip": "application/zip",
		"h.txt": "text/plain",
		"i.docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		"j.mov": "application/octet-stream",
	};
	for (const [name, contentType] of Object.entries(files)) f.addItem(name, "u1", { name, contentType });
	const select = async (condition) => (await f.db.select({ id: lib.driveItems.id }).from(lib.driveItems).where(condition)).map((row) => row.id).sort();

	assert.deepEqual(await select(lib.driveCategoryCondition("photos")), ["B.HEIC", "a.jpg", "c.svg"]);
	assert.deepEqual(await select(lib.driveCategoryCondition("videos")), ["d.mp4", "j.mov"]);
	// An .svg is image/* and an XML document; photos win.
	assert.deepEqual(await select(lib.driveCategoryCondition("documents")), ["e.md", "f.pdf", "h.txt", "i.docx"]);
	assert.deepEqual(await select(lib.driveCategoryCondition("others")), ["g.zip"]);
	assert.deepEqual(await select(lib.driveTypesCondition(["videos", "others"])), ["d.mp4", "g.zip", "j.mov"]);
});

/** u1 owns F > G > X and a top-level Y; F is linked publicly. */
async function sharedTree(t) {
	const f = await fixture(t);
	for (const id of ["u1", "u2", "u3", "u4"]) f.addUser(id);
	f.addItem("F", "u1", { kind: "folder", linkToken: "tok" });
	f.addItem("G", "u1", { kind: "folder", parentId: "F" });
	f.addItem("X", "u1", { parentId: "G" });
	f.addItem("Y", "u1");
	return f;
}

test("a share on an ancestor applies below it, edit beats view, and trash hides the subtree", async (t) => {
	const f = await sharedTree(t);
	f.share("F", "u2", "view");
	f.share("F", "u3", "view");
	f.share("G", "u3", "edit");
	const x = await f.item("X");

	assert.deepEqual((await lib.getDriveChain(f.db, x)).map((row) => row.id), ["F", "G", "X"]);
	assert.equal(await lib.getDriveRole(f.db, "u1", x), "owner");
	assert.equal(await lib.getDriveRole(f.db, "u2", x), "view");
	assert.equal(await lib.getDriveRole(f.db, "u3", x), "edit");
	assert.equal(await lib.getDriveRole(f.db, "u3", await f.item("F")), "view");
	assert.equal(await lib.getDriveRole(f.db, "u4", x), null);
	assert.equal(await lib.getDriveRole(f.db, "u2", await f.item("Y")), null, "a share on F says nothing about a sibling");

	f.sql.prepare("UPDATE drive_items SET trashed_at = ? WHERE id = 'G'").run(seconds(new Date()));
	assert.equal(await lib.getDriveRole(f.db, "u2", x), null);
	assert.equal(await lib.getDriveRole(f.db, "u1", x), null, "the owner too, outside the Trash view");
	assert.equal(await lib.getDriveRole(f.db, "u1", x, true), "owner");
});

test("a public link resolves its root and descendants only, and dies with trash or a hidden Drive", async (t) => {
	const f = await sharedTree(t);
	const resolved = async (token, itemId) => {
		const result = await lib.getPublicDriveItem(f.db, token, itemId);
		return result && [result.root.id, result.item.id];
	};
	assert.deepEqual(await resolved("tok"), ["F", "F"]);
	assert.deepEqual(await resolved("tok", "F"), ["F", "F"]);
	assert.deepEqual(await resolved("tok", "X"), ["F", "X"]);
	assert.equal(await resolved("tok", "Y"), null, "an item outside the linked folder");
	assert.equal(await resolved("tok", "missing"), null);
	assert.equal(await resolved("other"), null);

	f.sql.prepare("UPDATE drive_items SET trashed_at = ? WHERE id = 'G'").run(seconds(new Date()));
	assert.equal(await resolved("tok", "X"), null);
	assert.deepEqual(await resolved("tok"), ["F", "F"]);

	f.sql.prepare("UPDATE users SET drive_enabled = 0 WHERE id = 'u1'").run();
	assert.equal(await resolved("tok"), null, "an admin hiding the owner's Drive turns the link off");
	f.sql.prepare("UPDATE users SET drive_enabled = 1 WHERE id = 'u1'").run();
	f.sql.prepare("UPDATE drive_items SET trashed_at = ? WHERE id = 'F'").run(seconds(new Date()));
	assert.equal(await resolved("tok"), null);
});

test("descendants are collected breadth first and rows under a trashed folder are dropped", async (t) => {
	const f = await sharedTree(t);
	f.addItem("H", "u1", { kind: "folder", parentId: "F" });
	f.addItem("Z", "u1", { parentId: "H" });
	assert.deepEqual((await lib.collectDriveDescendants(f.db, ["F"])).map((row) => row.id), ["G", "H", "X", "Z"]);
	assert.deepEqual(await lib.collectDriveDescendants(f.db, []), []);

	f.sql.prepare("UPDATE drive_items SET trashed_at = ? WHERE id = 'G'").run(seconds(new Date()));
	const rows = await Promise.all(["X", "Y", "G", "Z"].map(f.item));
	// G itself carries trashedAt and is listed by the Trash view; only what sits under it is dropped.
	assert.deepEqual((await lib.withoutTrashedAncestors(f.db, rows)).map((row) => row.id), ["Y", "G", "Z"]);
});

test("item DTOs carry owner names, the shared flag, and the link token only for its owner", async (t) => {
	const f = await fixture(t);
	f.addUser("u1", { name: "", avatarKey: "avatars/u1" });
	f.addUser("u2", { name: "Bea" });
	f.addItem("A", "u1", { linkToken: "link-a" });
	f.addItem("B", "u1");
	f.addItem("C", "u2");
	f.share("B", "u2", "view");
	const rows = await Promise.all(["A", "B", "C"].map(f.item));

	const forOwner = await lib.toDriveItemDtos(f.db, rows, "u1");
	assert.deepEqual(forOwner.map((dto) => [dto.id, dto.role, dto.shared, dto.linkToken, dto.ownerName, dto.ownerHasAvatar]), [
		["A", "owner", true, "link-a", "u1@example.com", true],
		["B", "owner", true, null, "u1@example.com", true],
		["C", "view", false, null, "Bea", false],
	]);
	const forOther = await lib.toDriveItemDtos(f.db, rows, "u2", () => "edit");
	assert.equal(forOther[0].linkToken, null);
	assert.ok(forOther.every((dto) => dto.role === "edit"));
	assert.deepEqual(await lib.toDriveItemDtos(f.db, [], "u1"), []);
});

test("deleting a folder removes its subtree, shares and parts, but keeps objects an attachment still uses", async (t) => {
	const f = await sharedTree(t);
	f.addMailbox("mb1", "u1");
	f.addMessage("m1", "mb1", "u1");
	f.addAttachment("att1", "m1", { r2Key: "attachments/shared" });
	f.addItem("S", "u1", { parentId: "G", r2Key: "attachments/shared" });
	f.addItem("K", "u1", { parentId: "F", r2Key: "drive/u1/custom-key" });
	f.share("G", "u2", "edit");
	f.sql.prepare("INSERT INTO drive_upload_parts (item_id, part_number, etag) VALUES ('X', 1, 'etag')").run();

	await lib.deleteDriveItems(f.env, [await f.item("F")]);

	assert.deepEqual(f.ids("drive_items"), ["Y"]);
	assert.equal(f.sql.prepare("SELECT count(*) AS n FROM drive_shares").get().n, 0);
	assert.equal(f.sql.prepare("SELECT count(*) AS n FROM drive_upload_parts").get().n, 0);
	// X had no recorded key, so it lives at the owner's default key.
	assert.deepEqual(f.bucket.deleted.sort(), ["drive/u1/X", "drive/u1/custom-key"]);
	assert.deepEqual(f.ids("message_attachments"), ["att1"]);
});

test("a key is referenced by any row except the ones being removed", async (t) => {
	const f = await fixture(t);
	f.addUser("u1");
	f.addMailbox("mb1", "u1");
	f.addMessage("m1", "mb1", "u1");
	f.addAttachment("att1", "m1", { r2Key: "k1" });
	f.addItem("D", "u1", { r2Key: "k1" });
	f.addItem("E", "u1", { r2Key: "k2" });

	assert.deepEqual([...await lib.findReferencedKeys(f.db, ["k1", "k2", "k3"])].sort(), ["k1", "k2"]);
	assert.deepEqual([...await lib.findReferencedKeys(f.db, ["k1"], { driveItemIds: ["D"] })], ["k1"]);
	assert.deepEqual([...await lib.findReferencedKeys(f.db, ["k1"], { driveItemIds: ["D"], attachmentIds: ["att1"] })], []);

	assert.deepEqual(await lib.deleteUnreferencedObjects(f.env, f.db, ["k1", "k2", "k3", "k3"], { driveItemIds: ["E"] }), ["k2", "k3"]);
	assert.deepEqual(f.bucket.deleted, ["k2", "k3"]);
	assert.deepEqual(await lib.deleteUnreferencedObjects(f.env, f.db, []), []);
	assert.equal(f.bucket.deleted.length, 2);
});

test("the trash purge removes Drive items and attachments trashed 30 days ago or more", async (t) => {
	const f = await fixture(t);
	f.addUser("u1");
	f.addMailbox("mb1", "u1");
	f.addMessage("m1", "mb1", "u1");
	const now = new Date("2026-06-01T12:00:00Z");
	const old = new Date(now.getTime() - 31 * DAY_MS);
	const recent = new Date(now.getTime() - 29 * DAY_MS);
	const boundary = new Date(now.getTime() - 30 * DAY_MS);
	f.addItem("OldFolder", "u1", { kind: "folder", trashedAt: old });
	f.addItem("Inside", "u1", { parentId: "OldFolder", r2Key: "drive/u1/Inside" });
	f.addItem("Boundary", "u1", { trashedAt: boundary, r2Key: "drive/u1/Boundary" });
	f.addItem("Recent", "u1", { trashedAt: recent });
	f.addItem("Live", "u1", { r2Key: "attachments/kept-by-drive" });
	f.addAttachment("attOld", "m1", { trashedAt: old });
	f.addAttachment("attShared", "m1", { trashedAt: old, r2Key: "attachments/kept-by-drive" });
	f.addAttachment("attRecent", "m1", { trashedAt: recent });
	f.addAttachment("attLive", "m1");

	assert.equal(lib.DRIVE_TRASH_RETENTION_DAYS, 30);
	const removed = await lib.runDriveTrashRetention(f.env, now);
	assert.equal(removed, 4, "two expired Drive roots and two expired attachments");
	assert.deepEqual(f.ids("drive_items"), ["Live", "Recent"]);
	assert.deepEqual(f.ids("message_attachments"), ["attLive", "attRecent"]);
	assert.deepEqual(f.bucket.deleted.sort(), ["attachments/attOld", "drive/u1/Boundary", "drive/u1/Inside"]);
	assert.equal(await lib.runDriveTrashRetention(f.env, now), 0);
});

test("the storage limit comes from app settings and usage counts every row the owner has", async (t) => {
	const f = await fixture(t);
	f.addUser("u1");
	f.addUser("u2");
	assert.equal(await lib.getDriveStorageLimit(f.env), null);
	f.sql.prepare("UPDATE app_settings SET drive_storage_limit_bytes = 0 WHERE id = 'default'").run();
	assert.equal(await lib.getDriveStorageLimit(f.env), null, "0 means unlimited");
	f.sql.prepare("UPDATE app_settings SET drive_storage_limit_bytes = 1000 WHERE id = 'default'").run();
	assert.equal(await lib.getDriveStorageLimit(f.env), 1000);

	assert.equal(await lib.getDriveStorageUsed(f.db, "u1"), 0);
	f.addItem("a", "u1", { size: 300 });
	f.addItem("b", "u1", { size: 200, trashedAt: new Date() });
	f.addItem("c", "u2", { size: 999 });
	assert.equal(await lib.getDriveStorageUsed(f.db, "u1"), 500, "trashed files still use space until purged");
});

const uploadRequest = (body, headers = { "Sec-Fetch-Site": "same-origin" }) => new Request("https://mail.example.com/api/drive/upload", {
	method: "POST",
	headers: { "Content-Type": "application/json", ...headers },
	body: JSON.stringify(body),
});

test("starting an upload checks the session, the Drive switch and the request origin", async (t) => {
	const f = await fixture(t);
	const user = f.addUser("u1");

	let response = await lib.startUpload(uploadRequest({ size: 1 }));
	assert.equal(response.status, 401);

	state.user = { ...user, driveEnabled: false };
	response = await lib.startUpload(uploadRequest({ size: 1 }));
	assert.equal(response.status, 403);
	assert.deepEqual(await response.json(), { error: "Drive is disabled for this account" });
	assert.equal(lib.driveAccessError(null), null);
	assert.equal(lib.driveAccessError({ driveEnabled: true }), null);

	state.user = user;
	response = await lib.startUpload(uploadRequest({ size: 1 }, { "Sec-Fetch-Site": "cross-site" }));
	assert.equal(response.status, 403);
	assert.deepEqual(await response.json(), { error: "Invalid origin" });
	response = await lib.startUpload(uploadRequest({ size: 1 }, { Origin: "https://evil.example" }));
	assert.equal(response.status, 403);
	response = await lib.startUpload(uploadRequest({ size: 1 }, { Origin: "https://mail.example.com" }));
	assert.equal(response.status, 200);
});

test("an upload is refused when the size is invalid, too large or over the owner's quota", async (t) => {
	const f = await fixture(t);
	state.user = f.addUser("u1");
	f.addItem("existing", "u1", { size: 80 });
	f.sql.prepare("UPDATE app_settings SET drive_storage_limit_bytes = 100 WHERE id = 'default'").run();

	for (const size of [-1, 1.5, "10", undefined]) {
		const response = await lib.startUpload(uploadRequest({ name: "a", size }));
		assert.equal(response.status, 400, String(size));
	}
	let response = await lib.startUpload(uploadRequest({ name: "a", size: lib.DRIVE_MAX_FILE_BYTES + 1 }));
	assert.equal(response.status, 413);
	assert.deepEqual(await response.json(), { error: "File is too large" });

	response = await lib.startUpload(uploadRequest({ name: "a", size: 21 }));
	assert.equal(response.status, 413);
	assert.deepEqual(await response.json(), { error: "Not enough Drive storage left for this file" });
	assert.equal(f.bucket.multipart.length, 0);

	response = await lib.startUpload(uploadRequest({ name: " a/b ", size: 20, contentType: "text/plain", fingerprint: "fp" }));
	assert.equal(response.status, 200);
	const started = await response.json();
	assert.deepEqual({ ...started, id: undefined }, { id: undefined, partSize: lib.DRIVE_PART_BYTES, parts: 1, uploaded: [] });
	const row = f.sql.prepare("SELECT * FROM drive_items WHERE id = ?").get(started.id);
	assert.equal(row.name, "a b");
	assert.equal(row.r2_key, `drive/u1/${started.id}`);
	assert.equal(row.upload_id, "upload-1");
	assert.equal(row.upload_fingerprint, "fp");
	assert.equal(f.bucket.multipart[0].options.httpMetadata.contentType, "text/plain");

	// Picking the same file again resumes instead of starting over (and is not charged twice).
	response = await lib.startUpload(uploadRequest({ name: " a/b ", size: 20, contentType: "text/plain", fingerprint: "fp" }));
	const resumed = await response.json();
	assert.equal(resumed.id, started.id);
	assert.equal(resumed.resumed, true);
	assert.equal(f.bucket.multipart.length, 1);
});

test("an empty file is stored at once, and an upload into a shared folder counts against its owner", async (t) => {
	const f = await fixture(t);
	f.addUser("u1");
	const viewer = f.addUser("u2");
	const editor = f.addUser("u3");
	f.addItem("Shared", "u1", { kind: "folder" });
	f.addItem("big", "u1", { size: 90 });
	f.share("Shared", "u2", "view");
	f.share("Shared", "u3", "edit");
	f.sql.prepare("UPDATE app_settings SET drive_storage_limit_bytes = 100 WHERE id = 'default'").run();

	state.user = editor;
	let response = await lib.startUpload(uploadRequest({ size: 0 }));
	assert.equal(response.status, 200);
	const empty = await response.json();
	assert.equal(empty.complete, true);
	assert.equal(empty.item.name, "Untitled");
	assert.equal(empty.item.role, "owner");
	assert.deepEqual(f.bucket.puts.map((put) => put.key), [`drive/u3/${empty.item.id}`]);

	state.user = viewer;
	response = await lib.startUpload(uploadRequest({ size: 5, parentId: "Shared" }));
	assert.equal(response.status, 404, "view access cannot add files");
	response = await lib.startUpload(uploadRequest({ size: 5, parentId: "big" }));
	assert.equal(response.status, 404, "a file is not a folder");

	state.user = editor;
	response = await lib.startUpload(uploadRequest({ size: 11, parentId: "Shared" }));
	assert.equal(response.status, 413, "u1 has 10 bytes left even though u3 has used nothing");
	response = await lib.startUpload(uploadRequest({ size: 10, parentId: "Shared" }));
	assert.equal(response.status, 200);
	const { id } = await response.json();
	const row = f.sql.prepare("SELECT owner_id, parent_id, r2_key FROM drive_items WHERE id = ?").get(id);
	assert.deepEqual({ ...row }, { owner_id: "u1", parent_id: "Shared", r2_key: `drive/u1/${id}` });
});

test("the attachment view lists readable mail attachments and who may delete them", async (t) => {
	const f = await fixture(t);
	const owner = f.addUser("u1");
	const member = f.addUser("u2");
	f.addMailbox("mb1", "u1", { localPart: "u1" });
	f.addMailbox("team", "u1", { type: "shared", localPart: "team" });
	f.sql.prepare("INSERT INTO mailbox_access (id, mailbox_id, user_id, permission, created_at) VALUES ('acc', 'team', 'u2', 'read_only', 0)").run();

	f.addMessage("m1", "mb1", "u1");
	f.addAttachment("pdf1", "m1");
	f.addAttachment("inline1", "m1", { disposition: "inline", filename: "logo.png", contentType: "image/png" });
	f.addMessage("draft", "mb1", "u1", { status: "draft" });
	f.addAttachment("inDraft", "draft");
	f.addMessage("spam", "mb1", "u1", { status: "spam" });
	f.addAttachment("inSpam", "spam");
	f.addMessage("sent", "mb1", "u1", { status: "sent", direction: "outbound", from: "u1@example.com" });
	f.addAttachment("photo", "sent", { filename: "photo.jpg", contentType: "image/jpeg" });
	f.addAttachment("binned", "sent", { trashedAt: new Date() });
	f.addMessage("teamMail", "team", "u1");
	f.addAttachment("teamFile", "teamMail");

	const list = async (user, categories = [], trashed = false) => (await lib.listDriveAttachments(f.db, user, categories, trashed))
		.map((dto) => [dto.id, dto.ownerName, dto.source.canDelete]);

	assert.deepEqual(await list(owner), [
		["teamFile", "Anna", true],
		["photo", "u1@example.com", true],
		["pdf1", "Anna", true],
	]);
	assert.deepEqual(await list(owner, ["photos"]), [["photo", "u1@example.com", true]]);
	assert.deepEqual(await list(owner, [], true), [["binned", "u1@example.com", true]]);
	// Read-only access to a shared mailbox shows its files but cannot delete them.
	assert.deepEqual(await list(member), [["teamFile", "Anna", false]]);
});
