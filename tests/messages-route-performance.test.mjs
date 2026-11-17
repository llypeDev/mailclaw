import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { setImmediate } from "node:timers/promises";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(root, "tests", ".tmp-messages-route-"));
after(() => {
	rmSync(outDir, { recursive: true, force: true });
	delete globalThis.messagesRouteFixture;
});
const mocks = {
	"@/lib/cloudflare": "export function getEnv() { return globalThis.messagesRouteFixture.env; }",
	"@/lib/auth/cookies": "export async function getCurrentUser() { return globalThis.messagesRouteFixture.user; }",
	"@/lib/contacts/service": "export function getContactDisplayNameMap(env, userId, addresses) { return globalThis.messagesRouteFixture.contacts(userId, addresses); }",
	"@/lib/tracking/open-tracking": "export function getOpenCounts(env, ids) { return globalThis.messagesRouteFixture.opens(ids); }",
};
await build({
	entryPoints: {
		route: join(root, "src/app/api/messages/route.ts"),
		database: join(root, "server/runtime/sqlite-database.ts"),
		migrate: join(root, "server/runtime/migrate.ts"),
	},
	outdir: outDir,
	outExtension: { ".js": ".mjs" },
	bundle: true,
	platform: "node",
	format: "esm",
	packages: "external",
	tsconfig: join(root, "tsconfig.json"),
	logLevel: "silent",
	plugins: [{
		name: "message-route-fixtures",
		setup(builder) {
			builder.onResolve({ filter: /^next\/server$/ }, () => ({ path: "next/server.js", external: true }));
			builder.onResolve({ filter: /^@\/lib\// }, (args) => args.path in mocks ? { path: args.path, namespace: "mock" } : undefined);
			builder.onLoad({ filter: /.*/, namespace: "mock" }, (args) => ({ contents: mocks[args.path], loader: "js" }));
		},
	}],
});
const { GET } = await import(pathToFileURL(join(outDir, "route.mjs")).href);
const { SqliteDatabase } = await import(pathToFileURL(join(outDir, "database.mjs")).href);
const { applyMigrations } = await import(pathToFileURL(join(outDir, "migrate.mjs")).href);
const request = (query = "") => new Request(`https://mail.example/api/messages?${query}`);

async function fixture(t) {
	const database = new SqliteDatabase(":memory:");
	t.after(() => database.db.close());
	await applyMigrations(database, join(root, "drizzle/migrations"));
	database.db.exec(`
		INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES
			('owner', 'owner@example.com', 'Owner', 'x', 'admin', 0),
			('other', 'other@example.com', 'Other', 'x', 'user', 0);
		INSERT INTO domains (id, user_id, hostname, zone_id, created_at) VALUES ('domain', 'owner', 'example.com', 'zone', 0);
		INSERT INTO mailboxes (id, user_id, domain_id, local_part, type, disabled, created_at) VALUES
			('mine', 'owner', 'domain', 'owner', 'personal', 0, 0),
			('shared', 'other', 'domain', 'shared', 'shared', 0, 0),
			('private', 'other', 'domain', 'other', 'personal', 0, 0),
			('disabled', 'owner', 'domain', 'disabled', 'personal', 1, 0);
		INSERT INTO mailbox_access (id, mailbox_id, user_id, permission, created_at) VALUES ('grant', 'shared', 'owner', 'read_only', 0);
	`);
	const state = {
		database,
		env: { DB: database },
		user: { id: "owner", email: "owner@example.com", name: "Owner", role: "admin" },
		queries: [],
		started: [],
		async read(label) { this.started.push(label); },
		async contacts(userId, addresses) {
			await this.read(`contacts:${userId}`);
			assert.ok(addresses.includes("friend@example.com"));
			return new Map([["friend@example.com", { displayName: `Friend of ${userId}`, source: "inbound" }]]);
		},
		async opens(ids) {
			await this.read("opens");
			return new Map(ids.map((id) => [id, 3]));
		},
		message(id, { mailbox = "mine", user = "owner", thread = "thread", status = "received", direction = "inbound", read = false, time = 1, fromAddr = "friend@example.com", toAddr = "friend@example.com" } = {}) {
			database.db.prepare(`INSERT INTO messages (id, user_id, mailbox_id, direction, from_addr, to_addr, status, read, thread_id, snippet, text_body, html_body, raw_r2_key, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'preview', 'private body', '<p>private</p>', 'raw-key', ?)`).run(id, user, mailbox, direction, fromAddr, toAddr, status, Number(read), thread, time);
		},
	};
	const prepare = database.prepare.bind(database);
	database.prepare = (sql) => {
		state.queries.push(sql);
		function wrap(statement) {
			const bind = statement.bind.bind(statement);
			statement.bind = (...args) => wrap(bind(...args));
			const raw = statement.raw.bind(statement);
			statement.raw = async (...args) => {
				let label;
				if (sql.includes('from "messages"')) {
					label = sql.includes("group by") ? "threads" : sql.startsWith("select count(*)") ? "total" : "rows";
				} else if (sql.includes('from "outbound_jobs"')) label = "jobs";
				if (label) await state.read(label);
				return raw(...args);
			};
			return statement;
		}
		return wrap(prepare(sql));
	};
	globalThis.messagesRouteFixture = state;
	return state;
}

test("listed owned and read-only shared mailboxes reuse authorization without a second lookup", async (t) => {
	const f = await fixture(t);
	f.message("owned");
	f.message("delegated", { mailbox: "shared", user: "other" });
	for (const [mailbox, id] of [["mine", "owned"], ["shared", "delegated"]]) {
		f.queries.length = 0;
		const response = await GET(request(`mailboxId=${mailbox}`));
		assert.equal(response.status, 200);
		assert.deepEqual((await response.json()).messages.map((row) => row.id), [id]);
		assert.equal(f.queries.filter((sql) => sql.includes('from "mailboxes"') && !sql.includes("join")).length, 0);
	}
});

test("missing, disabled, private and invalid grants remain inaccessible", async (t) => {
	const f = await fixture(t);
	for (const mailbox of ["missing", "disabled", "private"]) {
		assert.equal((await GET(request(`mailboxId=${mailbox}`))).status, 404);
	}
	f.database.db.exec("UPDATE mailbox_access SET permission = 'invalid'");
	assert.equal((await GET(request("mailboxId=shared"))).status, 404);
	f.database.db.exec("UPDATE mailbox_access SET permission = 'read_only'");
	assert.equal(f.started.length, 0, "denied requests never load mail or enrichment");
	assert.equal((await GET(request("mailboxId=shared"))).status, 200, "a valid grant is readable on every installation");
	f.user = null;
	f.queries.length = 0;
	assert.equal((await GET(request())).status, 401);
	assert.equal(f.queries.length, 0);
});

test("explicit orphaned mailbox keeps the existing access fallback", async (t) => {
	const f = await fixture(t);
	f.database.db.pragma("foreign_keys = OFF");
	f.database.db.exec("UPDATE mailboxes SET domain_id = 'missing' WHERE id = 'mine'");
	f.database.db.pragma("foreign_keys = ON");
	f.message("orphan");
	assert.equal((await GET(request("mailboxId=mine"))).status, 200);
});

// Hold reads at their asynchronous boundary, then inspect which siblings started.
// No elapsed-time performance threshold: the assertion measures overlap, not speed.
async function holdReads(f, labels, callback) {
	const gate = Promise.withResolvers();
	const entered = Promise.withResolvers();
	f.read = async (label) => {
		f.started.push(label);
		if (labels.includes(label)) {
			entered.resolve();
			await gate.promise;
		}
	};
	const pending = GET(request("mailboxId=mine&scheduled=true"));
	try {
		await entered.promise;
		await setImmediate();
		callback();
	} finally {
		gate.resolve();
		await pending;
	}
	return (await pending).json();
}

function schedule(f) {
	f.message("scheduled", { direction: "outbound", status: "queued" });
	f.database.db.exec("INSERT INTO outbound_jobs (id, user_id, message_id, payload, scheduled_at, created_at, updated_at) VALUES ('job', 'owner', 'scheduled', '{}', 2000000000, 0, 0)");
}

test("pages never count the folder unless the page cannot prove the total", async (t) => {
	const f = await fixture(t);
	for (let index = 0; index < 5; index += 1) f.message(`m${index}`, { thread: `t${index}`, time: index + 1 });
	// The per-thread "(3)" sizes are a grouped count over the page's threads; a folder count has no group by.
	const folderCounts = () => f.queries.filter((sql) => sql.includes("count(") && !sql.includes("group by")).length;
	for (const group of ["", "&group=thread"]) {
		f.queries.length = 0;
		const full = await (await GET(request(`mailboxId=mine&status=received&limit=2${group}`))).json();
		assert.deepEqual(full.messages.map((row) => row.id), ["m4", "m3"]);
		assert.equal(full.hasMore, true);
		// A conversation scan that reached the end of a small folder already knows the total.
		assert.equal(full.total, group ? 5 : null, "a full page leaves the total to count=only");
		assert.equal(folderCounts(), 0, "no count on a page with more after it");

		const last = await (await GET(request(`mailboxId=mine&status=received&limit=2&offset=4${group}`))).json();
		assert.deepEqual(last.messages.map((row) => row.id), ["m0"]);
		assert.equal(last.hasMore, false);
		assert.equal(last.total, 5, "the last page proves the total");
		assert.equal(folderCounts(), 0);

		const counted = await (await GET(request(`mailboxId=mine&status=received&count=only${group}`))).json();
		assert.equal(counted.total, 5);
		assert.equal("messages" in counted, false);
	}
	f.message("reply", { thread: "t4", time: 10 });
	assert.equal((await (await GET(request("mailboxId=mine&status=received&count=only&group=thread"))).json()).total, 5);
	assert.equal((await (await GET(request("mailboxId=mine&status=received&count=only"))).json()).total, 6);
});

test("thread, schedule, tracking and contact enrichment reads overlap", async (t) => {
	const f = await fixture(t);
	schedule(f);
	const body = await holdReads(f, ["threads", "jobs", "opens", "contacts:owner"], () => {
		for (const label of ["threads", "jobs", "opens", "contacts:owner"]) assert.ok(f.started.includes(label), `${label} must start before other enrichment resolves`);
	});
	const [message] = body.messages;
	assert.equal(message.scheduledAt, "2033-05-18T03:33:20.000Z");
	assert.equal(message.openCount, 3);
	assert.equal(message.fromContactName, "Owner");
	assert.equal(message.toContactName, "Friend of owner");
	assert.equal(message.snippet, "preview");
	for (const key of ["textBody", "htmlBody", "rawR2Key"]) assert.equal(key in message, false);
});

test("grouped unread counts and actions stay folder-scoped while thread totals exclude draft and trash", async (t) => {
	const f = await fixture(t);
	f.message("old", { time: 1 });
	f.message("head", { time: 2, read: true });
	f.message("archive", { status: "archived", time: 3 });
	f.message("draft", { status: "draft", time: 4 });
	f.message("trash", { status: "trash", time: 5 });
	f.message("private", { mailbox: "private", user: "other", time: 6 });
	const response = await GET(request("mailboxId=mine&status=received&group=thread"));
	const body = await response.json();
	assert.equal(body.grouped, true);
	assert.equal(body.total, 1);
	assert.equal(body.messages[0].id, "head");
	assert.equal(body.messages[0].threadCount, 3);
	assert.equal(body.messages[0].threadUnread, 1);
	assert.deepEqual(body.messages[0].threadMessageIds.sort(), ["head", "old"]);
	const ungrouped = await (await GET(request("mailboxId=mine&status=received&limit=1&offset=1"))).json();
	assert.equal(ungrouped.total, 2);
	assert.equal(ungrouped.messages[0].id, "old");
	assert.equal(ungrouped.messages[0].threadUnread, 2);
	const drafts = await (await GET(request("mailboxId=mine&status=draft&group=thread"))).json();
	assert.equal(drafts.grouped, false);
	assert.equal(drafts.messages[0].id, "draft");
});

test("all-mailbox lists keep per-owner contacts and reflect revoked sharing on the next request", async (t) => {
	const f = await fixture(t);
	f.message("own");
	f.message("shared", { mailbox: "shared", user: "other", time: 2 });
	f.message("private", { mailbox: "private", user: "other", time: 3 });
	const body = await (await GET(request())).json();
	assert.deepEqual(body.messages.map((row) => [row.id, row.fromContactName]), [["shared", "Friend of other"], ["own", "Friend of owner"]]);
	f.database.db.exec("DELETE FROM mailbox_access");
	assert.deepEqual((await (await GET(request())).json()).messages.map((row) => row.id), ["own"]);
	assert.equal((await GET(request("mailboxId=shared"))).status, 404);
});

test("a shared sender address keeps each message's own display name", async (t) => {
	const f = await fixture(t);
	f.message("posthog", { fromAddr: '"PostHog Team" <no-reply@ashbyhq.com>', time: 1 });
	f.message("livekit", { fromAddr: '"LiveKit Hiring Team" <no-reply@ashbyhq.com>', time: 2 });
	// The contact learned the most recent sender's name for the shared address.
	f.contacts = async () => new Map([["no-reply@ashbyhq.com", { displayName: "LiveKit Hiring Team", source: "inbound" }]]);
	const body = await (await GET(request("mailboxId=mine"))).json();
	assert.deepEqual(body.messages.map((row) => [row.id, row.fromContactName]), [
		["livekit", "LiveKit Hiring Team"],
		["posthog", "PostHog Team"],
	]);

	// A name the user set on the contact is deliberate and wins for every message.
	f.contacts = async () => new Map([["no-reply@ashbyhq.com", { displayName: "Ashby Recruiting", source: "manual" }]]);
	const manual = await (await GET(request("mailboxId=mine"))).json();
	assert.deepEqual(manual.messages.map((row) => row.fromContactName), ["Ashby Recruiting", "Ashby Recruiting"]);
});

test("a shared recipient address keeps each outbound message's own display name", async (t) => {
	const f = await fixture(t);
	f.message("posthog", { direction: "outbound", toAddr: '"PostHog Team" <no-reply@ashbyhq.com>', time: 1 });
	f.message("livekit", { direction: "outbound", toAddr: '"LiveKit Hiring Team" <no-reply@ashbyhq.com>', time: 2 });
	// The contact learned the most recent recipient's name for the shared address.
	f.contacts = async () => new Map([["no-reply@ashbyhq.com", { displayName: "PostHog Team", source: "outbound" }]]);
	const body = await (await GET(request("mailboxId=mine&direction=outbound"))).json();
	assert.deepEqual(body.messages.map((row) => [row.id, row.toContactName]), [
		["livekit", "LiveKit Hiring Team"],
		["posthog", "PostHog Team"],
	]);

	// A name the user set on the contact is deliberate and wins for every message.
	f.contacts = async () => new Map([["no-reply@ashbyhq.com", { displayName: "Ashby Recruiting", source: "manual" }]]);
	const manual = await (await GET(request("mailboxId=mine&direction=outbound"))).json();
	assert.deepEqual(manual.messages.map((row) => row.toContactName), ["Ashby Recruiting", "Ashby Recruiting"]);
});

test("empty pages preserve total and skip unnecessary thread and scheduled reads", async (t) => {
	const f = await fixture(t);
	schedule(f);
	const body = await (await GET(request("mailboxId=mine&scheduled=true&offset=100"))).json();
	assert.equal(body.total, 1);
	assert.deepEqual(body.messages, []);
	assert.ok(!f.started.includes("threads"));
	assert.ok(!f.started.includes("jobs"));
	assert.ok(!f.started.some((label) => label.startsWith("contacts:")));
});

test("conversation rows and members are read by key, not by walking the folder", async (t) => {
	const f = await fixture(t);
	f.message("a1", { thread: "ta", time: 1 });
	f.message("a2", { thread: "ta", time: 3, read: true });
	f.message("lonely", { thread: null, time: 2 });
	f.message("archived", { thread: "ta", status: "archived", time: 4 });
	f.queries.length = 0;
	const body = await (await GET(request("mailboxId=mine&status=received&group=thread"))).json();
	assert.deepEqual(body.messages.map((row) => [row.id, [...row.threadMessageIds].sort(), row.threadUnread]), [
		["a2", ["a1", "a2"], 1],
		["lonely", ["lonely"], 1],
	]);
	const plan = (sql) => {
		const params = Array.from({ length: (sql.match(/\?/g) ?? []).length }, () => null);
		return f.database.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params).map((row) => row.detail).join(" | ");
	};
	const pageRows = f.queries.find((sql) => sql.includes('"snippet"') && sql.includes('where "messages"."id" in'));
	assert.ok(pageRows, "page rows are fetched by id alone");
	assert.match(plan(pageRows), /sqlite_autoindex_messages_1/);
	const members = f.queries.find((sql) => sql.includes('"thread_member"'));
	assert.ok(members);
	const memberPlan = plan(members);
	assert.match(memberPlan, /SEARCH thread_member USING INDEX messages_thread_idx/, memberPlan);
	assert.match(memberPlan, /SEARCH messages (EXISTS )?USING INDEX sqlite_autoindex_messages_1/, memberPlan);
});

const queryPlan = (f, sql) => {
	const params = Array.from({ length: (sql.match(/\?/g) ?? []).length }, () => null);
	return f.database.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params).map((row) => row.detail).join(" | ");
};

async function walk(path, limit) {
	const pages = [];
	let cursor = null;
	for (let offset = 0; pages.length < 100; offset += limit) {
		const response = await GET(request(`${path}&limit=${limit}&offset=${offset}${cursor ? `&cursor=${cursor}` : ""}`));
		assert.equal(response.status, 200);
		const body = await response.json();
		pages.push(body);
		if (!body.hasMore) return pages;
		cursor = body.nextCursor;
		assert.equal(typeof cursor, "string");
	}
	throw new Error("walk did not end");
}

test("cursor pages walk the list in (created_at, id) order without repeating rows of the same second", async (t) => {
	const f = await fixture(t);
	// Pairs of messages share a second, so the id breaks the tie at page boundaries.
	for (let index = 0; index < 9; index += 1) f.message(`m${index}`, { thread: `t${index % 4}`, time: Math.floor(index / 2) });
	const byOffset = await (await GET(request("mailboxId=mine&status=received&limit=100"))).json();
	assert.deepEqual(byOffset.messages.map((row) => row.id), ["m8", "m7", "m6", "m5", "m4", "m3", "m2", "m1", "m0"]);
	assert.equal(byOffset.nextCursor, null);
	for (const limit of [1, 2, 4]) {
		const pages = await walk("mailboxId=mine&status=received", limit);
		assert.deepEqual(pages.flatMap((page) => page.messages.map((row) => row.id)), byOffset.messages.map((row) => row.id), `limit ${limit}`);
		assert.equal(pages.at(-1).total, 9, "the last page proves the total from the echoed offset");
		assert.equal(pages.at(-1).nextCursor, null);
	}
	// Conversation view: one row per thread, newest first, each thread once.
	const grouped = await walk("mailboxId=mine&status=received&group=thread", 1);
	assert.deepEqual(grouped.flatMap((page) => page.messages.map((row) => row.id)), ["m8", "m7", "m6", "m5"]);
	assert.deepEqual(grouped[0].messages[0].threadMessageIds.sort(), ["m0", "m4", "m8"]);

	assert.equal((await GET(request("mailboxId=mine&status=received&cursor=bogus"))).status, 400);
});

test("cursor pages seek the page index instead of reading the rows before them", async (t) => {
	const f = await fixture(t);
	for (let index = 0; index < 4; index += 1) f.message(`m${index}`, { time: index });
	const first = await (await GET(request("mailboxId=mine&direction=inbound&status=received&limit=1"))).json();
	for (const [path, index] of [
		["mailboxId=mine&direction=inbound&status=received", "messages_nav_cover_idx"],
		["mailboxId=mine&direction=inbound&status=received&read=unread", "messages_nav_cover_idx"],
		["mailboxId=mine&direction=outbound&status=sent", "messages_status_page_idx"],
		["mailboxId=mine&status=archived", "messages_status_page_idx"],
		["mailboxId=mine&starred=true", "messages_starred_page_idx"],
	]) {
		f.queries.length = 0;
		assert.equal((await GET(request(`${path}&limit=1&offset=1&cursor=${first.nextCursor}`))).status, 200);
		const page = f.queries.find((sql) => sql.includes('"snippet"') && sql.includes("limit"));
		const plan = queryPlan(f, page);
		assert.match(plan, new RegExp(`USING INDEX ${index} \\(mailbox_id=\\? AND [^)]*created_at<\\?\\)`), `${path}: ${plan}`);
		assert.doesNotMatch(plan, /TEMP B-TREE/, `${path}: ${plan}`);
	}
});

test("all-mailbox pages walk the page index per mailbox instead of sorting the whole inbox", async (t) => {
	const f = await fixture(t);
	f.message("own", { time: 1, thread: "own" });
	f.message("shared", { mailbox: "shared", user: "other", time: 2, thread: "shared" });
	for (const path of ["direction=inbound&status=received", "direction=inbound&status=received&read=unread", "direction=inbound&status=received&group=thread"]) {
		f.queries.length = 0;
		const body = await (await GET(request(path))).json();
		assert.deepEqual(body.messages.map((row) => row.id), ["shared", "own"]);
		const page = f.queries.find((sql) => sql.includes('from "messages"') && sql.includes("limit") && sql.includes('"mailbox_id" in'));
		const plan = queryPlan(f, page);
		// The IN list still merges through a small sorter, but each mailbox's walk stops once the page
		// is full: messages_counts_cover_idx would hand over the whole inbox unordered.
		assert.match(plan, /USING (COVERING )?INDEX messages_nav_cover_idx \(mailbox_id=\? AND status=\? AND folder_id=\? AND created_at<\?\)/, `${path}: ${plan}`);
	}
});

test("list totals come from message_counters where the tallies answer the view exactly", async (t) => {
	const f = await fixture(t);
	f.message("inbox-unread", { time: 1 });
	f.message("inbox-read", { time: 2, read: true });
	f.message("starred-archived", { time: 3, status: "archived" });
	f.message("starred-sent", { time: 4, status: "sent", direction: "outbound", read: true });
	f.message("snoozed", { time: 5 });
	f.message("in-folder", { time: 6 });
	f.message("template", { time: 7, status: "template", direction: "outbound" });
	f.message("shared-starred", { mailbox: "shared", user: "other", time: 8 });
	f.message("private-starred", { mailbox: "private", user: "other", time: 9 });
	f.database.db.exec(`
		INSERT INTO folders (id, user_id, mailbox_id, name, created_at) VALUES ('folder', 'owner', 'mine', 'Folder', 0);
		UPDATE messages SET starred = 1 WHERE id IN ('starred-archived', 'starred-sent', 'snoozed', 'template', 'shared-starred', 'private-starred');
		UPDATE messages SET snoozed_until = 4000000000 WHERE id = 'snoozed';
		UPDATE messages SET folder_id = 'folder' WHERE id = 'in-folder';
	`);
	const cases = [
		["mailboxId=mine&starred=true", 3],
		["starred=true", 4],
		["mailboxId=mine&starred=true&read=unread", 2],
		["mailboxId=mine&direction=inbound&status=received", 2],
		["direction=inbound&status=received", 3],
		["mailboxId=mine&direction=inbound&status=received&read=unread", 1],
		["mailboxId=mine&direction=inbound&status=received&folderId=folder", 1],
		["mailboxId=mine&status=archived", 1],
		["mailboxId=mine&direction=outbound&status=sent", 1],
		// Everything but the template.
		["mailboxId=mine", 6],
	];
	for (const [path, expected] of cases) {
		f.queries.length = 0;
		const body = await (await GET(request(`${path}&count=only`))).json();
		assert.equal(body.total, expected, path);
		assert.ok(f.queries.some((sql) => sql.includes('from "message_counters"')), `${path} reads the tallies`);
		assert.ok(!f.queries.some((sql) => sql.includes("count(")), `${path} counts nothing`);
		// The same views listed in full agree with the tallies.
		const listed = await (await GET(request(`${path}&limit=100`))).json();
		assert.equal(listed.messages.length, expected, `${path} listed`);
	}
	// Grouped, snoozed and searched views still count the rows.
	for (const path of ["mailboxId=mine&direction=inbound&status=received&group=thread", "mailboxId=mine&snoozed=true", "mailboxId=mine&q=preview"]) {
		f.queries.length = 0;
		await GET(request(`${path}&count=only`));
		assert.ok(!f.queries.some((sql) => sql.includes('from "message_counters"')), path);
	}
	// Before migration 0089 the total is counted as before.
	f.database.db.exec("DROP TABLE message_counters");
	assert.equal((await (await GET(request("mailboxId=mine&starred=true&count=only"))).json()).total, 3);
});
