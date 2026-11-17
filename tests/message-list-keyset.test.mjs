import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(root, "tests", ".tmp-message-list-keyset-"));
after(() => rmSync(outDir, { recursive: true, force: true }));

await build({
	entryPoints: {
		totals: join(root, "src/hooks/message-total-utils.ts"),
		counts: join(root, "src/app/api/messages/list-count-utils.ts"),
	},
	outdir: outDir,
	outExtension: { ".js": ".mjs" },
	bundle: true,
	platform: "node",
	format: "esm",
	tsconfig: join(root, "tsconfig.json"),
	logLevel: "silent",
});
const { getMessageTotalKey, rememberPageCursor, withPageCursor } = await import(pathToFileURL(join(outDir, "totals.mjs")).href);
const { countListFromTallies, listCountRowMatches } = await import(pathToFileURL(join(outDir, "counts.mjs")).href);

const params = (query) => new URLSearchParams(query);

test("a view's total and cursors ignore the page's cursor", () => {
	assert.equal(getMessageTotalKey(params("status=received&offset=50&cursor=abc")), getMessageTotalKey(params("status=received")));
});

test("pages past the first carry the cursor recorded for their offset", () => {
	const pages = new Map();
	rememberPageCursor(pages, 0, 50, "c50");
	rememberPageCursor(pages, 50, 50, "c100");
	assert.equal(withPageCursor(params("status=received"), pages).get("cursor"), null, "the first page needs none");
	assert.equal(withPageCursor(params("status=received&offset=50"), pages).get("cursor"), "c50");
	assert.equal(withPageCursor(params("status=received&offset=100"), pages).get("cursor"), "c100");
	assert.equal(withPageCursor(params("status=received&offset=150"), pages).get("cursor"), null, "a jump loads by offset");
	assert.equal(withPageCursor(params("offset=50"), undefined).get("cursor"), null);

	// Reloading page 1 replaces the cursor of page 2 and forgets the ones derived from the old page 2.
	rememberPageCursor(pages, 0, 50, "c50-new");
	assert.deepEqual([...pages.entries()], [[50, "c50-new"]]);
	// The last page has no next cursor.
	rememberPageCursor(pages, 0, 50, null);
	assert.equal(pages.size, 0);
});

const filter = (overrides = {}) => ({ direction: null, folderId: null, status: null, inbox: false, starred: false, read: null, ...overrides });
const row = (overrides = {}) => ({ folderId: null, direction: "inbound", status: "received", read: false, starred: false, ...overrides });

test("tally rows match the list's filters", () => {
	assert.equal(listCountRowMatches(row({ status: "template" }), filter()), false, "templates are never listed");
	assert.equal(listCountRowMatches(row({ status: "template" }), filter({ status: "template" })), true);
	assert.equal(listCountRowMatches(row({ folderId: "f" }), filter({ status: "received", inbox: true })), false);
	assert.equal(listCountRowMatches(row({ folderId: "f" }), filter({ folderId: "f" })), true);
	assert.equal(listCountRowMatches(row({ folderId: "g" }), filter({ folderId: "f" })), false);
	assert.equal(listCountRowMatches(row({ starred: true, status: "sent", direction: "outbound" }), filter({ starred: true })), true);
	assert.equal(listCountRowMatches(row({ read: true }), filter({ read: false })), false);
	assert.equal(listCountRowMatches(row(), filter({ direction: "outbound" })), false);
});

test("the inbox total leaves out messages snoozed right now", () => {
	const tallies = [
		{ ...row(), total: 10 },
		{ ...row({ read: true }), total: 5 },
		{ ...row({ folderId: "f" }), total: 7 },
		{ ...row({ status: "archived" }), total: 3 },
	];
	const snoozed = [row(), row({ read: true }), row({ status: "archived" })];
	assert.equal(countListFromTallies(tallies, snoozed, filter({ direction: "inbound", status: "received", inbox: true })), 13);
	assert.equal(countListFromTallies(tallies, snoozed, filter({ direction: "inbound", status: "received", inbox: true, read: false })), 9);
	// Archived lists snoozed messages like any other.
	assert.equal(countListFromTallies(tallies, snoozed, filter({ status: "archived" })), 3);
	assert.equal(countListFromTallies(tallies, [], filter()), 25);
});
