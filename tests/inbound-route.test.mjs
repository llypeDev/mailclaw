import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const directory = mkdtempSync(join(root, "tests", ".tmp-inbound-route-"));
after(() => rmSync(directory, { recursive: true, force: true }));
await build({
	stdin: {
		contents: `
			export { SqliteDatabase } from "./server/runtime/sqlite-database.ts";
			export { applyMigrations } from "./server/runtime/migrate.ts";
			export { processInboundMessage } from "./src/lib/email/inbound.ts";
			export { intakeIncomingMail } from "./src/lib/email/intake.ts";
			export { inboundRouteFromDecision, parseInboundRoute, isInboundRouteCurrent } from "./src/lib/email/inbound-route-utils.ts";
			export { mailboxNotificationUserIds, getMailboxNotificationUserIds } from "./src/lib/realtime/utils.ts";
		`,
		resolveDir: root,
		sourcefile: "inbound-route-entry.ts",
	},
	outfile: join(directory, "entry.mjs"),
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node22",
	tsconfig: join(root, "tsconfig.json"),
	packages: "external",
	alias: { "next/headers": "next/headers.js", "next/server": "next/server.js", "cloudflare:workers": "./server/runtime/cloudflare-workers.ts" },
	logLevel: "silent",
});
const {
	SqliteDatabase,
	applyMigrations,
	processInboundMessage,
	intakeIncomingMail,
	inboundRouteFromDecision,
	parseInboundRoute,
	isInboundRouteCurrent,
	mailboxNotificationUserIds,
	getMailboxNotificationUserIds,
} = await import(pathToFileURL(join(directory, "entry.mjs")).href);

/**
 * Counts what D1 bills as queries: each statement run on its own, and each batch as one,
 * however many statements it carries.
 */
function countingDatabase(database) {
	const counter = { queries: 0, sql: [] };
	let inBatch = false;
	const wrap = (statement, sql) => new Proxy(statement, {
		get(target, property) {
			if (property === "bind") return (...values) => wrap(target.bind(...values), sql);
			const value = target[property];
			if (typeof value !== "function") return value;
			if (["first", "run", "all", "raw"].includes(property)) {
				return (...args) => {
					if (!inBatch) {
						counter.queries++;
						counter.sql.push(sql);
					}
					return value.apply(target, args);
				};
			}
			return value.bind(target);
		},
	});
	const db = new Proxy(database, {
		get(target, property) {
			if (property === "prepare") return (sql) => wrap(target.prepare(sql), sql);
			if (property === "batch") {
				return async (statements) => {
					counter.queries++;
					counter.sql.push(`batch(${statements.length})`);
					inBatch = true;
					try {
						return await target.batch(statements);
					} finally {
						inBatch = false;
					}
				};
			}
			const value = target[property];
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
	return { db, counter };
}

function memoryBucket() {
	const objects = new Map();
	return {
		objects,
		async put(key, value) {
			objects.set(key, value instanceof ArrayBuffer ? value : typeof value === "string" ? new TextEncoder().encode(value).buffer : new Uint8Array(value).buffer);
		},
		async get(key) {
			const value = objects.get(key);
			return value ? { arrayBuffer: async () => value, text: async () => new TextDecoder().decode(value), json: async () => JSON.parse(new TextDecoder().decode(value)) } : null;
		},
		async head(key) {
			return objects.has(key) ? {} : null;
		},
		async delete(key) {
			for (const item of Array.isArray(key) ? key : [key]) objects.delete(item);
		},
	};
}

const RAW = [
	"From: Alice <alice@sender.test>",
	"To: owner@one.test",
	"Subject: Lunch on Friday",
	"Message-ID: <lunch-1@sender.test>",
	"Date: Tue, 17 Nov 2026 10:00:00 +0000",
	"Content-Type: text/plain; charset=utf-8",
	"",
	"Are you free for lunch on Friday?",
	"",
].join("\r\n");

async function fixture(t) {
	const database = new SqliteDatabase(":memory:");
	t.after(() => database.db.close());
	await applyMigrations(database, join(root, "drizzle/migrations"));
	database.db.exec(`
		INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES ('owner', 'owner@one.test', 'hash', 'Owner', 'admin', 1);
		INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES ('helper', 'helper@one.test', 'hash', 'Helper', 'user', 1);
		INSERT INTO domains (id, user_id, hostname, zone_id, status, created_at) VALUES ('d1', 'owner', 'one.test', 'manual', 'active', 1);
		INSERT INTO mailboxes (id, user_id, domain_id, local_part, created_at) VALUES ('mb1', 'owner', 'd1', 'owner', 1);
	`);
	const { db, counter } = countingDatabase(database);
	const bucket = memoryBucket();
	const notified = [];
	const env = {
		DB: db,
		BUCKET: bucket,
		REALTIME: {
			getByName: (userId) => ({ fetch: async () => { notified.push(userId); return new Response(null, { status: 204 }); } }),
		},
	};
	const realFetch = globalThis.fetch;
	globalThis.fetch = async () => new Response("not found", { status: 404 });
	t.after(() => { globalThis.fetch = realFetch; });
	return { database, env, counter, bucket, notified };
}

async function enqueue(bucket, key = `inbound/${Math.random().toString(36).slice(2)}.eml`) {
	await bucket.put(key, new TextEncoder().encode(RAW).buffer);
	return key;
}

const ROUTE = { mailboxId: "mb1", userId: "owner", localPart: "owner", hostname: "one.test" };

function storedRow(database, rawR2Key) {
	const row = database.db.prepare("SELECT mailbox_id AS mailboxId, user_id AS userId, status FROM messages WHERE raw_r2_key = ?").get(rawR2Key);
	return row ? { ...row } : null;
}

// resolveInboundAddress always starts with the active-domain lookup.
const resolvesAddress = (sql) => sql.some((statement) => /from "domains" where \("domains"\."hostname" = \? and "domains"\."status" = \?\)/.test(statement));

test("a carried route saves the routing and notification queries of a typical message", async (t) => {
	const recovered = await fixture(t);
	const recoveredKey = await enqueue(recovered.bucket);
	// A payload without a route: queued before this change, or recovered after a Node restart.
	await processInboundMessage(recovered.env, { from: "alice@sender.test", to: "owner@one.test", rawR2Key: recoveredKey, headers: { subject: "Lunch on Friday" } });
	assert.deepEqual(storedRow(recovered.database, recoveredKey), { mailboxId: "mb1", userId: "owner", status: "received" });
	assert.deepEqual(recovered.notified, ["owner"]);
	assert.ok(resolvesAddress(recovered.counter.sql), "without a route the consumer resolves the address");

	const carried = await fixture(t);
	const carriedKey = await enqueue(carried.bucket);
	await processInboundMessage(carried.env, { from: "alice@sender.test", to: "owner@one.test", rawR2Key: carriedKey, headers: { subject: "Lunch on Friday" }, route: ROUTE });
	assert.deepEqual(storedRow(carried.database, carriedKey), { mailboxId: "mb1", userId: "owner", status: "received" });
	assert.deepEqual(carried.notified, ["owner"]);
	assert.ok(!resolvesAddress(carried.counter.sql), carried.counter.sql.join("\n"));
	assert.ok(!carried.counter.sql.some((sql) => /from "mailboxes" inner join "domains"/.test(sql)), "the notification recipients come from the batch");
	assert.ok(!carried.counter.sql.some((sql) => /"auto_reply_enabled"/.test(sql)), "an auto-reply that is off is not looked up again");
	t.diagnostic(`D1 queries per inbound message: ${recovered.counter.queries} without a route, ${carried.counter.queries} with one`);
	// The routing lookup (domain, domain rules, mailboxes) is what the route saves.
	assert.ok(carried.counter.queries <= recovered.counter.queries - 3, `${recovered.counter.queries} -> ${carried.counter.queries}`);
});

test("a stale route falls back to resolving the address", async (t) => {
	for (const [label, change, expectedMailbox] of [
		["disabled mailbox", "UPDATE mailboxes SET disabled = 1 WHERE id = 'mb1'", null],
		["deleted mailbox", "DELETE FROM mailboxes WHERE id = 'mb1'", null],
		["inactive domain", "UPDATE domains SET status = 'pending' WHERE id = 'd1'", null],
		["renamed mailbox, new one on the old address", "UPDATE mailboxes SET local_part = 'old' WHERE id = 'mb1'; INSERT INTO mailboxes (id, user_id, domain_id, local_part, created_at) VALUES ('mb2', 'helper', 'd1', 'owner', 2);", "mb2"],
	]) {
		const { database, env, counter, bucket } = await fixture(t);
		database.db.exec(change);
		const rawR2Key = await enqueue(bucket);
		await processInboundMessage(env, { from: "alice@sender.test", to: "owner@one.test", rawR2Key, headers: {}, route: ROUTE });
		assert.ok(resolvesAddress(counter.sql), `${label}: resolved again`);
		assert.equal(storedRow(database, rawR2Key)?.mailboxId ?? null, expectedMailbox, label);
		if (!expectedMailbox) assert.ok(!bucket.objects.has(rawR2Key), `${label}: the unroutable raw object is dropped`);
	}
});

test("a route that does not match the recipient or the mailbox owner is not trusted", async (t) => {
	for (const [label, payload] of [
		["another user", { to: "owner@one.test", route: { ...ROUTE, userId: "helper" } }],
		["another domain", { to: "owner@other.test", route: ROUTE }],
		["malformed", { to: "owner@one.test", route: { mailboxId: "mb1", userId: 7 } }],
	]) {
		const { database, env, counter, bucket } = await fixture(t);
		database.db.exec("INSERT INTO mailboxes (id, user_id, domain_id, local_part, created_at) VALUES ('mb2', 'helper', 'd1', 'helper', 2)");
		const rawR2Key = await enqueue(bucket);
		await processInboundMessage(env, { from: "alice@sender.test", rawR2Key, headers: {}, ...payload });
		assert.ok(resolvesAddress(counter.sql), `${label}: resolved again`);
		const expected = payload.to === "owner@one.test" ? { mailboxId: "mb1", userId: "owner", status: "received" } : null;
		assert.deepEqual(storedRow(database, rawR2Key), expected, label);
	}
});

test("a redelivered message with a route is still stored once", async (t) => {
	const { database, env, bucket } = await fixture(t);
	const rawR2Key = await enqueue(bucket);
	const payload = { from: "alice@sender.test", to: "owner@one.test", rawR2Key, headers: {}, route: ROUTE };
	await processInboundMessage(env, payload);
	await processInboundMessage(env, payload);
	assert.equal(database.db.prepare("SELECT count(*) AS n FROM messages WHERE raw_r2_key = ?").get(rawR2Key).n, 1);
});

test("shared mailbox notifications reach the domain owner and every member, from the batch", async (t) => {
	const { database, env, counter, bucket, notified } = await fixture(t);
	database.db.exec(`
		INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES ('member', 'member@one.test', 'hash', 'Member', 'user', 1);
		INSERT INTO mailboxes (id, user_id, domain_id, local_part, type, created_at) VALUES ('team', 'helper', 'd1', 'team', 'shared', 1);
		INSERT INTO mailbox_access (id, mailbox_id, user_id, created_at) VALUES ('a1', 'team', 'member', 1);
	`);
	const rawR2Key = await enqueue(bucket);
	await processInboundMessage(env, { from: "alice@sender.test", to: "team@one.test", rawR2Key, headers: {}, route: { mailboxId: "team", userId: "helper", localPart: "team", hostname: "one.test" } });
	assert.equal(storedRow(database, rawR2Key)?.mailboxId, "team");
	assert.deepEqual([...notified].sort(), ["helper", "member", "owner"]);
	assert.ok(!counter.sql.some((sql) => /from "mailbox_access"/.test(sql)), "access rows come from the batch");
	assert.deepEqual([...await getMailboxNotificationUserIds(env, "team", "helper")].sort(), ["helper", "member", "owner"]);
	assert.deepEqual(await getMailboxNotificationUserIds(env, "mb1", "owner"), ["owner"]);
});

test("an enabled auto-reply is still handed to the auto-reply sender", async (t) => {
	const { database, env, counter, bucket } = await fixture(t);
	database.db.exec("UPDATE mailboxes SET auto_reply_enabled = 1, auto_reply_body = 'Away' WHERE id = 'mb1'");
	const rawR2Key = await enqueue(bucket);
	await processInboundMessage(env, { from: "alice@sender.test", to: "owner@one.test", rawR2Key, headers: {}, route: ROUTE });
	assert.ok(counter.sql.some((sql) => /"auto_reply_enabled"/.test(sql)));
});

test("intake carries the store decision on the queue message, and only that one", async (t) => {
	const { database } = await fixture(t);
	const input = { from: "a@b.test", to: "owner@one.test", raw: new TextEncoder().encode("Subject: x\r\n\r\nhi").buffer, headers: { subject: "x" } };
	const sent = [];
	const env = { DB: database, BUCKET: memoryBucket(), INBOUND_QUEUE: { async send(body) { sent.push(body); } } };
	await intakeIncomingMail(env, input, {});
	assert.deepEqual(sent[0].route, ROUTE);
	assert.ok(JSON.stringify(sent[0]).length < 128 * 1024);

	// A mailbox forward without a copy that failed is stored, but the consumer decides that case itself.
	database.db.exec(`
		INSERT INTO routing_rules (id, user_id, domain_id, scope, pattern, mailbox_id, action, forward_to, keep_copy, created_at)
		VALUES ('fw', 'owner', 'd1', 'mailbox', '*', 'mb1', 'forward', 'rule@far.test', 0, 1);
	`);
	await intakeIncomingMail(env, input, { forward: async () => false });
	assert.equal(sent.length, 2);
	assert.equal(sent[1].route, undefined);

	// Unknown recipients carry nothing either.
	await intakeIncomingMail(env, { ...input, to: "nobody@one.test" }, {});
	assert.equal(sent[2].route, undefined);
});

test("only store outcomes become a route", () => {
	const mailbox = { mailboxId: "mb1", folderId: null, userId: "owner", domainId: "d1", localPart: "owner", hostname: "one.test", displayName: "Owner" };
	assert.deepEqual(inboundRouteFromDecision({ action: "store", mailbox }), ROUTE);
	assert.deepEqual(inboundRouteFromDecision({ action: "forward", forwardTo: "x@far.test", keepCopy: true, mailbox }), ROUTE);
	assert.equal(inboundRouteFromDecision({ action: "forward", forwardTo: "x@far.test", keepCopy: false, mailbox }), undefined);
	assert.equal(inboundRouteFromDecision({ action: "forward", forwardTo: "x@far.test", keepCopy: true }), undefined);
	assert.equal(inboundRouteFromDecision({ action: "reject", rejectReason: "no" }), undefined);
	assert.equal(inboundRouteFromDecision({ action: "store" }), undefined);
	assert.equal(inboundRouteFromDecision(null), undefined);
});

test("route shape and freshness checks", () => {
	assert.deepEqual(parseInboundRoute({ ...ROUTE, extra: 1 }), ROUTE);
	for (const bad of [null, "mb1", {}, { ...ROUTE, userId: "" }, { ...ROUTE, hostname: 5 }, { ...ROUTE, localPart: "x".repeat(400) }]) {
		assert.equal(parseInboundRoute(bad), null, JSON.stringify(bad));
	}
	const current = { mailbox: { userId: "owner", localPart: "owner", disabled: false }, recipientDomainStatus: "active" };
	assert.equal(isInboundRouteCurrent(ROUTE, "owner@one.test", current), true);
	assert.equal(isInboundRouteCurrent(ROUTE, "Owner+tag@ONE.test", current), true);
	assert.equal(isInboundRouteCurrent(ROUTE, "sales@one.test", current), true, "aliases and catch-alls keep the mailbox's own local part");
	assert.equal(isInboundRouteCurrent(ROUTE, "owner@two.test", current), false);
	assert.equal(isInboundRouteCurrent(ROUTE, "not an address", current), false);
	assert.equal(isInboundRouteCurrent(ROUTE, "owner@one.test", { ...current, recipientDomainStatus: "pending" }), false);
	assert.equal(isInboundRouteCurrent(ROUTE, "owner@one.test", { ...current, recipientDomainStatus: undefined }), false);
	assert.equal(isInboundRouteCurrent(ROUTE, "owner@one.test", { ...current, mailbox: undefined }), false);
	assert.equal(isInboundRouteCurrent(ROUTE, "owner@one.test", { ...current, mailbox: { ...current.mailbox, disabled: true } }), false);
	assert.equal(isInboundRouteCurrent(ROUTE, "owner@one.test", { ...current, mailbox: { ...current.mailbox, userId: "helper" } }), false);
	assert.equal(isInboundRouteCurrent(ROUTE, "owner@one.test", { ...current, mailbox: { ...current.mailbox, localPart: "renamed" } }), false);
});

test("notification recipients", () => {
	assert.deepEqual(mailboxNotificationUserIds("owner", null, ["x"]), ["owner"]);
	assert.deepEqual(mailboxNotificationUserIds("owner", { domainOwnerUserId: "admin", type: "personal" }, ["x"]), ["owner", "admin"]);
	assert.deepEqual(mailboxNotificationUserIds("owner", { domainOwnerUserId: "owner", type: "shared" }, ["x", "owner"]), ["owner", "x"]);
});
