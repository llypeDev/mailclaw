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

	assert.deepEqual(first, { ids: ["c"], hasMore: true, total: 2 });
	assert.deepEqual(second, { ids: ["b"], hasMore: false, total: 2 });
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

	assert.deepEqual(page, { ids: ["visible"], hasMore: false, total: 1 });
});

test("an offset past the end returns no heads and retains the real total", async (t) => {
	const fixture = createConversationFixture(SqliteDatabase, [at(1, "only-message")]);
	t.after(() => fixture.database.db.close());
	const page = await loadConversationPage({ db: fixture.db, where: fixture.where, offset: 50, limit: 25 });

	// The scan reached the end of the folder, so it knows the total without a count.
	assert.equal(fixture.queryCount(), 1);
	assert.deepEqual(page, { ids: [], hasMore: false, total: 1 });
});

test("a deep offset past the end counts once so the list can step back", async (t) => {
	const fixture = createConversationFixture(SqliteDatabase, [at(1, "a"), at(2, "b", "b-thread")]);
	t.after(() => fixture.database.db.close());
	const page = await loadConversationPage({ db: fixture.db, where: fixture.where, offset: 20000, limit: 25 });

	assert.equal(fixture.queryCount(), 2);
	assert.deepEqual(page, { ids: [], hasMore: false, total: 2 });
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
