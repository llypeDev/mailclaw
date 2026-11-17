import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { at, createConversationFixture } from "./conversation-page-utils.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(root, "tests", ".tmp-conversation-page-"));
after(() => rmSync(outDir, { recursive: true, force: true }));

await build({
	entryPoints: {
		page: join(root, "src/app/api/messages/utils.ts"),
		cursor: join(root, "src/app/api/messages/list-cursor-utils.ts"),
		database: join(root, "server/runtime/sqlite-database.ts"),
	},
	outdir: outDir,
	outExtension: { ".js": ".mjs" },
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node22",
	tsconfig: join(root, "tsconfig.json"),
	external: ["better-sqlite3", "drizzle-orm", "drizzle-orm/*"],
	logLevel: "silent",
});

const { loadConversationPage, pageTotalWithoutCount, splitPageRows } = await import(pathToFileURL(join(outDir, "page.mjs")).href);
const { SqliteDatabase } = await import(pathToFileURL(join(outDir, "database.mjs")).href);
const { decodeListCursor, encodeListCursor } = await import(pathToFileURL(join(outDir, "cursor.mjs")).href);

test("deep conversation pages use one query and leave the total to a count", async (t) => {
	const rows = Array.from({ length: 15000 }, (_, index) => at(index, `m${String(index).padStart(5, "0")}`));
	const fixture = createConversationFixture(SqliteDatabase, rows);
	t.after(() => fixture.database.db.close());
	const page = await loadConversationPage({ db: fixture.db, where: fixture.where, offset: 12500, limit: 25 });

	assert.equal(fixture.queryCount(), 1);
	assert.equal(page.total, null);
	assert.equal(page.hasMore, true);
	assert.equal(page.ids.length, 25);
	assert.equal(page.ids[0], "m02499");
	assert.equal(page.ids.at(-1), "m02475");
});

test("a long conversation does not consume one query per batch of messages", async (t) => {
	const rows = Array.from({ length: 15000 }, (_, index) => at(index, `m${String(index).padStart(5, "0")}`, "long-thread"));
	const fixture = createConversationFixture(SqliteDatabase, rows);
	t.after(() => fixture.database.db.close());
	const page = await loadConversationPage({ db: fixture.db, where: fixture.where, offset: 0, limit: 25 });

	assert.ok(fixture.queryCount() <= 4);
	assert.equal(page.total, 1);
	assert.deepEqual(page.ids, ["m14999"]);
});

test("equal timestamps select one head per thread before applying the offset", async (t) => {
	const fixture = createConversationFixture(SqliteDatabase, [
		at(100, "a", "same-thread"),
		at(100, "c", "same-thread"),
		at(100, "b", null),
	]);
	t.after(() => fixture.database.db.close());
	const first = await loadConversationPage({ db: fixture.db, where: fixture.where, offset: 0, limit: 1 });
	const second = await loadConversationPage({ db: fixture.db, where: fixture.where, offset: 1, limit: 1 });

	assert.deepEqual({ ...first, nextCursor: typeof first.nextCursor }, { ids: ["c"], hasMore: true, total: 2, nextCursor: "string" });
	assert.deepEqual(second, { ids: ["b"], hasMore: false, total: 2, nextCursor: null });
});

test("counts and conversation heads share mailbox and status filters", async (t) => {
	const fixture = createConversationFixture(SqliteDatabase, [
		at(100, "visible", "shared-thread"),
		at(200, "other-mailbox", "shared-thread", "theirs"),
		at(300, "archived", "shared-thread", "mine", "archived"),
		at(400, "hidden-thread", "hidden", "theirs"),
	]);
	t.after(() => fixture.database.db.close());
	const page = await loadConversationPage({ db: fixture.db, where: fixture.where, offset: 0, limit: 25 });

	assert.deepEqual(page, { ids: ["visible"], hasMore: false, total: 1, nextCursor: null });
});

test("an offset past the end returns no heads and retains the real total", async (t) => {
	const fixture = createConversationFixture(SqliteDatabase, [at(1, "only-message")]);
	t.after(() => fixture.database.db.close());
	const page = await loadConversationPage({ db: fixture.db, where: fixture.where, offset: 50, limit: 25 });

	// The scan reached the end of the folder, so it knows the total without a count.
	assert.equal(fixture.queryCount(), 1);
	assert.deepEqual(page, { ids: [], hasMore: false, total: 1, nextCursor: null });
});

test("a deep offset past the end counts once so the list can step back", async (t) => {
	const fixture = createConversationFixture(SqliteDatabase, [at(1, "a"), at(2, "b", "b-thread")]);
	t.after(() => fixture.database.db.close());
	const page = await loadConversationPage({ db: fixture.db, where: fixture.where, offset: 20000, limit: 25 });

	assert.equal(fixture.queryCount(), 2);
	assert.deepEqual(page, { ids: [], hasMore: false, total: 2, nextCursor: null });
});

test("a full first page reports hasMore and no total; the last page proves it", async (t) => {
	const rows = Array.from({ length: 60 }, (_, index) => at(index, `m${String(index).padStart(2, "0")}`));
	const fixture = createConversationFixture(SqliteDatabase, rows);
	t.after(() => fixture.database.db.close());
	const first = await loadConversationPage({ db: fixture.db, where: fixture.where, offset: 0, limit: 25 });
	assert.equal(first.hasMore, true);
	assert.equal(first.ids[0], "m59");
	// 60 rows fit in the first scan batch, so even the first page saw the end.
	assert.equal(first.total, 60);
	const last = await loadConversationPage({ db: fixture.db, where: fixture.where, offset: 50, limit: 25 });
	assert.deepEqual({ hasMore: last.hasMore, total: last.total, size: last.ids.length }, { hasMore: false, total: 60, size: 10 });
});

test("page totals come from the page only when it proves them", () => {
	assert.equal(pageTotalWithoutCount(0, 0, false), 0);
	assert.equal(pageTotalWithoutCount(0, 7, false), 7);
	assert.equal(pageTotalWithoutCount(50, 3, false), 53);
	assert.equal(pageTotalWithoutCount(0, 50, true), null);
	assert.equal(pageTotalWithoutCount(100, 0, false), null, "past the end only a count knows the total");
	assert.deepEqual(splitPageRows([1, 2, 3], 2), { rows: [1, 2], hasMore: true });
	assert.deepEqual(splitPageRows([1, 2], 2), { rows: [1, 2], hasMore: false });
});

/** Conversation heads in list order, computed in JavaScript from the fixture rows. */
function expectedHeads(rows) {
	const heads = new Map();
	for (const row of rows) {
		if (row.mailboxId !== "mine" || row.status !== "received") continue;
		const key = row.threadId ?? row.id;
		const current = heads.get(key);
		if (!current || row.createdAt > current.createdAt || (row.createdAt === current.createdAt && row.id > current.id)) heads.set(key, row);
	}
	return [...heads.values()]
		.sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
		.map((row) => row.id);
}

async function walkByCursor(fixture, limit) {
	const ids = [];
	let cursor = null;
	let offset = 0;
	for (let pages = 0; pages < 1000; pages += 1) {
		const page = await loadConversationPage({ db: fixture.db, where: fixture.where, offset, limit, cursor: cursor && decodeListCursor(cursor), seek: true });
		ids.push(...page.ids);
		if (!page.hasMore) return { ids, last: page };
		assert.equal(typeof page.nextCursor, "string");
		cursor = page.nextCursor;
		offset += limit;
	}
	throw new Error("cursor walk did not end");
}

test("cursor pages list every conversation once, in order, across shared seconds and threads that straddle a page", async (t) => {
	const rows = [];
	// Threads whose messages sit on both sides of page boundaries, many messages per second, other
	// mailboxes and statuses in the same threads, and messages without a thread.
	for (let index = 0; index < 400; index += 1) {
		const seconds = Math.floor(index / 4);
		const thread = index % 7 === 0 ? null : `t${index % 37}`;
		const mailboxId = index % 11 === 0 ? "theirs" : "mine";
		const status = index % 13 === 0 ? "archived" : "received";
		rows.push(at(seconds, `m${String(index).padStart(3, "0")}`, thread, mailboxId, status));
	}
	const fixture = createConversationFixture(SqliteDatabase, rows);
	t.after(() => fixture.database.db.close());
	const expected = expectedHeads(rows);
	for (const limit of [1, 3, 7, 25]) {
		const { ids, last } = await walkByCursor(fixture, limit);
		assert.deepEqual(ids, expected, `limit ${limit}`);
		assert.equal(last.nextCursor, null);
		assert.equal(last.total, expected.length, "the last cursor page proves the total from the caller's offset");
	}
});

test("cursor pages follow the windowed plan when threads are long", async (t) => {
	const rows = [];
	// Six threads of 300 consecutive messages, plus a few replies to older threads: a scan batch
	// finds about one head, so every page bails out to the window function.
	for (let index = 0; index < 1800; index += 1) rows.push(at(index, `m${String(index).padStart(4, "0")}`, `t${Math.floor(index / 300)}`));
	rows.push(at(1500, "late-reply", "t0"), at(1500, "late-reply-2", "t1"));
	const fixture = createConversationFixture(SqliteDatabase, rows);
	t.after(() => fixture.database.db.close());
	const windowed = [];
	const prepare = fixture.database.prepare;
	fixture.database.prepare = (query) => {
		if (query.includes("row_number()")) windowed.push(query);
		return prepare(query);
	};
	const { ids } = await walkByCursor(fixture, 2);
	assert.deepEqual(ids, expectedHeads(rows));
	assert.ok(windowed.length >= 2, "the walk used the windowed plan");
});

test("a cursor places the page and the offset only echoes the caller's position", async (t) => {
	const rows = Array.from({ length: 30 }, (_, index) => at(index, `m${String(index).padStart(2, "0")}`));
	const fixture = createConversationFixture(SqliteDatabase, rows);
	t.after(() => fixture.database.db.close());
	const first = await loadConversationPage({ db: fixture.db, where: fixture.where, offset: 0, limit: 10 });
	const second = await loadConversationPage({ db: fixture.db, where: fixture.where, offset: 999, limit: 10, cursor: decodeListCursor(first.nextCursor), seek: true });
	assert.equal(second.ids[0], "m19");
	assert.equal(second.ids.at(-1), "m10");
	assert.equal(second.hasMore, true);
	assert.equal(second.total, null);
});

test("list cursors round-trip and refuse anything else", () => {
	const cursor = encodeListCursor({ createdAt: new Date(1_700_000_123_000), id: "msg-ü/1" });
	assert.match(cursor, /^[A-Za-z0-9_-]+$/);
	assert.deepEqual(decodeListCursor(cursor), { createdAt: new Date(1_700_000_123_000), id: "msg-ü/1" });
	// Sub-second precision is not stored, so it is not carried either.
	assert.deepEqual(decodeListCursor(encodeListCursor({ createdAt: new Date(1_700_000_123_999), id: "a" })).createdAt, new Date(1_700_000_123_000));
	for (const bad of [null, "", "not base64!", "a2", Buffer.from("k1:abc:id").toString("base64url"), Buffer.from("k2:1:id").toString("base64url"), Buffer.from("k1:1:").toString("base64url"), "x".repeat(600)]) {
		assert.equal(decodeListCursor(bad), null, String(bad));
	}
});
