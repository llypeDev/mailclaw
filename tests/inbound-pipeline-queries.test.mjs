import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const directory = mkdtempSync(join(root, "tests", ".tmp-inbound-pipeline-"));
after(() => rmSync(directory, { recursive: true, force: true }));
await build({
	stdin: {
		contents: `
			export { SqliteDatabase } from "./server/runtime/sqlite-database.ts";
			export { applyMigrations } from "./server/runtime/migrate.ts";
			export { getDb } from "./src/db/index.ts";
			export { recordContactFromAddress, upsertContactFromAddress, importContactAvatar } from "./src/lib/contacts/service.ts";
			export { classifyTokens } from "./src/lib/spam/classifier.ts";
			export { analyzeSpam } from "./src/lib/spam/engine.ts";
			export { storeMessageAttachments, loadMessageAttachmentContents } from "./src/lib/email/attachments.ts";
			export { mapWithConcurrency } from "./src/lib/email/attachment-storage-utils.ts";
			export { getAccountForwardingDestination } from "./src/lib/email/account-forwarding.ts";
			export { intakeIncomingMail } from "./src/lib/email/intake.ts";
			export { mayHaveUnsubscribeHeader } from "./src/lib/email/unsubscribe.ts";
		`,
		resolveDir: root,
		sourcefile: "inbound-pipeline-entry.ts",
	},
	outfile: join(directory, "entry.mjs"),
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node22",
	tsconfig: join(root, "tsconfig.json"),
	packages: "external",
	logLevel: "silent",
});
const {
	SqliteDatabase,
	applyMigrations,
	getDb,
	recordContactFromAddress,
	upsertContactFromAddress,
	importContactAvatar,
	classifyTokens,
	analyzeSpam,
	storeMessageAttachments,
	loadMessageAttachmentContents,
	mapWithConcurrency,
	getAccountForwardingDestination,
	intakeIncomingMail,
	mayHaveUnsubscribeHeader,
} = await import(pathToFileURL(join(directory, "entry.mjs")).href);

async function fixture(t) {
	const database = new SqliteDatabase(":memory:");
	t.after(() => database.db.close());
	await applyMigrations(database, join(root, "drizzle/migrations"));
	database.db.exec(`
		INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES ('owner', 'owner@one.test', 'hash', 'Owner', 'admin', 1);
		INSERT INTO domains (id, user_id, hostname, zone_id, status, created_at) VALUES ('d1', 'owner', 'one.test', 'manual', 'active', 1);
		INSERT INTO mailboxes (id, user_id, domain_id, local_part, created_at) VALUES ('mb1', 'owner', 'd1', 'owner', 1);
		INSERT INTO messages (id, user_id, mailbox_id, direction, from_addr, to_addr, subject, status, created_at)
		VALUES ('m1', 'owner', 'mb1', 'inbound', 'a@b.test', 'owner@one.test', 'x', 'received', 1);
	`);
	return { database, db: getDb({ DB: database }) };
}

function memoryBucket({ failPut } = {}) {
	const objects = new Map();
	let inFlight = 0;
	const bucket = {
		objects,
		maxInFlight: 0,
		deleted: [],
		async put(key, value) {
			inFlight++;
			bucket.maxInFlight = Math.max(bucket.maxInFlight, inFlight);
			await new Promise((resolve) => setTimeout(resolve, 2));
			inFlight--;
			if (failPut?.(key)) throw new Error(`put failed: ${key}`);
			objects.set(key, value instanceof ArrayBuffer ? value : new Uint8Array(value).buffer);
		},
		async get(key) {
			inFlight++;
			bucket.maxInFlight = Math.max(bucket.maxInFlight, inFlight);
			await new Promise((resolve) => setTimeout(resolve, 2));
			inFlight--;
			const value = objects.get(key);
			return value ? { arrayBuffer: async () => value } : null;
		},
		async delete(key) {
			for (const item of Array.isArray(key) ? key : [key]) {
				bucket.deleted.push(item);
				objects.delete(item);
			}
		},
	};
	return bucket;
}

// The rules upsertContactFromAddress used to apply in JavaScript after a SELECT.
function expectedName(existingName, existingSource, nextName, incomingSource) {
	if (existingSource === "manual") return existingName;
	if (incomingSource === "inbound" && existingName) return existingName;
	return nextName || existingName;
}
function expectedSource(existingSource, incomingSource) {
	return existingSource === "manual" || (existingSource === "outbound" && incomingSource === "inbound") ? existingSource : incomingSource;
}

test("the one-statement contact update keeps the old name and source rules", async (t) => {
	const { database } = await fixture(t);
	const env = { DB: database };
	let index = 0;
	for (const existingSource of ["manual", "inbound", "outbound"]) {
		for (const existingName of [null, "", "Known"]) {
			for (const incomingSource of ["inbound", "outbound"]) {
				for (const incomingName of [null, "Sender Name"]) {
					const email = `c${index++}@x.test`;
					database.db.prepare("INSERT INTO contacts (id, user_id, email, display_name, source, last_seen_at, created_at) VALUES (?, 'owner', ?, ?, ?, 1, 1)")
						.run(`owner:${email}`, email, existingName, existingSource);
					const address = incomingName ? `"${incomingName}" <${email}>` : email;
					const result = await recordContactFromAddress(env, { userId: "owner", address, source: incomingSource });
					const label = `${existingSource}/${JSON.stringify(existingName)} <- ${incomingSource}/${JSON.stringify(incomingName)}`;
					assert.equal(result.created, false, label);
					assert.equal(result.contact.displayName, expectedName(existingName, existingSource, incomingName, incomingSource), label);
					assert.equal(result.contact.source, expectedSource(existingSource, incomingSource), label);
					assert.ok(result.contact.lastSeenAt.getTime() > 1000, label);
				}
			}
		}
	}
});

test("a new sender is created once and reported as created only the first time", async (t) => {
	const { database } = await fixture(t);
	const env = { DB: database };
	const first = await recordContactFromAddress(env, { userId: "owner", address: '"Ada" <Ada@Example.test>', source: "inbound" });
	assert.equal(first.created, true);
	assert.equal(first.contact.email, "ada@example.test");
	assert.equal(first.contact.displayName, "Ada");
	const again = await recordContactFromAddress(env, { userId: "owner", address: "ada@example.test", source: "inbound" });
	assert.equal(again.created, false);
	assert.equal(again.contact.displayName, "Ada");
	assert.equal(database.db.prepare("SELECT count(*) AS n FROM contacts WHERE email = 'ada@example.test'").get().n, 1);
	assert.equal(await recordContactFromAddress(env, { userId: "owner", address: "  ", source: "inbound" }), null);
});

test("upsertContactFromAddress still fetches the avatar for new contacts only, and the import stores it", async (t) => {
	const { database } = await fixture(t);
	const bucket = memoryBucket();
	const env = { DB: database, BUCKET: bucket };
	const realFetch = globalThis.fetch;
	const requests = [];
	globalThis.fetch = async (url, init) => {
		requests.push({ url: String(url), signal: init?.signal });
		return new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "image/png" } });
	};
	t.after(() => { globalThis.fetch = realFetch; });
	const created = await upsertContactFromAddress(env, { userId: "owner", address: "new@x.test", source: "inbound" });
	assert.ok(created.avatarKey);
	assert.equal(requests.length, 2);
	assert.ok(requests.every((request) => request.signal instanceof AbortSignal), "Gravatar requests carry a timeout signal");
	await upsertContactFromAddress(env, { userId: "owner", address: "new@x.test", source: "inbound" });
	assert.equal(requests.length, 2, "an existing contact is not looked up again");
	await upsertContactFromAddress(env, { userId: "owner", address: "quiet@x.test", source: "inbound", lookupAvatar: false });
	assert.equal(requests.length, 2);
	const key = await importContactAvatar(env, "owner", "quiet@x.test");
	assert.equal(database.db.prepare("SELECT avatar_key AS k FROM contacts WHERE email = 'quiet@x.test'").get().k, key);
});

test("the classifier reads both feedback totals with one grouped count", async (t) => {
	const { database, db } = await fixture(t);
	assert.equal((await classifyTokens(db, "mb1", ["a"])).trainedMessages, 0);
	database.db.exec("PRAGMA foreign_keys = OFF");
	const insert = database.db.prepare("INSERT INTO spam_feedback (message_id, mailbox_id, classification, training_tokens, reputation_keys, created_at, updated_at) VALUES (?, ?, ?, '[]', '[]', 1, 1)");
	for (let i = 0; i < 3; i++) insert.run(`s${i}`, "mb1", "spam");
	insert.run("h0", "mb1", "ham");
	insert.run("other", "mb2", "ham");
	const result = await classifyTokens(db, "mb1", []);
	assert.equal(result.trainedMessages, 4);
	const onlySpam = await classifyTokens(db, "mb2", ["a"]);
	assert.equal(onlySpam.trainedMessages, 1);
	assert.equal(onlySpam.contribution, 0);
});

test("reputation for sender, domain and fingerprint comes from one query and still scores", async (t) => {
	const { database, db } = await fixture(t);
	const message = { subject: "Hello", text: "Hello there", html: null, messageId: "<a@spammer.test>", fromAddr: "bad@spammer.test", toAddr: "owner@one.test", ccAddr: null, bccAddr: null, replyTo: null, inReplyTo: null, references: [], date: null, attachments: [] };
	const input = { mailboxId: "mb1", userId: "owner", envelopeFrom: "bad@spammer.test", headers: {}, message, intelligenceProvider: { check: async () => [] } };
	const before = await analyzeSpam(db, input);
	assert.ok(!before.signals.some((signal) => signal.id.endsWith("_reputation")));
	const insert = database.db.prepare("INSERT INTO spam_reputation (mailbox_id, type, key, messages_seen, spam_count, ham_count, first_seen_at, last_seen_at) VALUES ('mb1', ?, ?, 5, ?, ?, 1, 1)");
	insert.run("domain", "spammer.test", 5, 0);
	insert.run("email", "other@spammer.test", 0, 5);
	const after = await analyzeSpam(db, input);
	assert.ok(after.signals.some((signal) => signal.id === "poor_domain_reputation"), JSON.stringify(after.signals));
	assert.ok(!after.signals.some((signal) => signal.id === "good_email_reputation"), "a row for another address does not apply");
});

test("attachments are written a few at a time and inserted in chunks, in order", async (t) => {
	const { database } = await fixture(t);
	const bucket = memoryBucket();
	const env = { DB: database, BUCKET: bucket };
	const files = Array.from({ length: 13 }, (_, i) => ({ filename: `f${i}.txt`, type: "text/plain", content: new TextEncoder().encode(`file ${i}`).buffer }));
	const stored = await storeMessageAttachments(env, "m1", files, { validate: false });
	assert.equal(stored.length, 13);
	assert.ok(bucket.maxInFlight > 1 && bucket.maxInFlight <= 6, `in flight: ${bucket.maxInFlight}`);
	assert.equal(database.db.prepare("SELECT count(*) AS n FROM message_attachments WHERE message_id = 'm1'").get().n, 13);
	bucket.maxInFlight = 0;
	bucket.objects.delete(stored[4].r2Key);
	const loaded = await loadMessageAttachmentContents(env, "m1");
	assert.deepEqual(loaded.map((file) => file.filename), files.map((file) => file.filename).filter((name) => name !== "f4.txt"));
	assert.equal(new TextDecoder().decode(loaded[0].content), "file 0");
	assert.ok(bucket.maxInFlight > 1 && bucket.maxInFlight <= 6);
});

test("a failed write or insert removes every object and row it created", async (t) => {
	const { database } = await fixture(t);
	const files = Array.from({ length: 12 }, (_, i) => ({ filename: `g${i}.txt`, type: "text/plain", content: new ArrayBuffer(4) }));
	const failing = memoryBucket({ failPut: (key) => key.endsWith("g5.txt") });
	await assert.rejects(storeMessageAttachments({ DB: database, BUCKET: failing }, "m1", files, { validate: false }), /put failed/);
	assert.equal(failing.objects.size, 0);
	assert.equal(database.db.prepare("SELECT count(*) AS n FROM message_attachments").get().n, 0);

	// The message row does not exist, so the inserts (two, in one batch) hit the foreign key after
	// every put landed, and the batch leaves no row behind.
	const bucket = memoryBucket();
	await assert.rejects(storeMessageAttachments({ DB: database, BUCKET: bucket }, "missing", files, { validate: false }));
	assert.equal(bucket.objects.size, 0);
	assert.equal(database.db.prepare("SELECT count(*) AS n FROM message_attachments").get().n, 0);
});

test("mapWithConcurrency stops starting work after a failure but waits for what runs", async () => {
	const started = [];
	const finished = [];
	await assert.rejects(mapWithConcurrency([0, 1, 2, 3, 4, 5, 6, 7], 3, async (item) => {
		started.push(item);
		await new Promise((resolve) => setTimeout(resolve, item === 1 ? 1 : 10));
		if (item === 1) throw new Error("boom");
		finished.push(item);
		return item;
	}), /boom/);
	assert.deepEqual(started.sort(), [0, 1, 2]);
	assert.deepEqual(finished.sort(), [0, 2]);
	assert.deepEqual(await mapWithConcurrency([3, 1, 2], 2, async (item) => item * 2), [6, 2, 4]);
});

test("account forwarding reuses the routing decision instead of resolving again", async (t) => {
	const { database } = await fixture(t);
	database.db.exec("UPDATE users SET forwarding_email = 'elsewhere@far.test' WHERE id = 'owner'");
	const env = { DB: database };
	assert.equal(await getAccountForwardingDestination(env, "owner@one.test", null), null);
	assert.equal(await getAccountForwardingDestination(env, "owner@one.test", { action: "reject" }), null);
	assert.equal(await getAccountForwardingDestination(env, "owner@one.test", { action: "store", mailbox: { mailboxId: "mb1", userId: "owner" } }), "elsewhere@far.test");
	database.db.exec("UPDATE users SET forwarding_email = 'owner@one.test' WHERE id = 'owner'");
	assert.equal(await getAccountForwardingDestination(env, "owner@one.test", { action: "store", mailbox: { mailboxId: "mb1", userId: "owner" } }), null);
});

function intakeFixture(database, { failPut = false } = {}) {
	const events = [];
	const env = {
		DB: database,
		BUCKET: {
			async put(key) {
				events.push(`put ${key.slice(0, 8)}`);
				if (failPut) throw new Error("R2 down");
			},
		},
		INBOUND_QUEUE: { async send() { events.push("enqueue"); } },
	};
	return { env, events };
}

test("intake stores and enqueues before any forward that keeps a copy, so a retry never forwards twice", async (t) => {
	const { database } = await fixture(t);
	database.db.exec(`
		UPDATE users SET forwarding_email = 'account@far.test' WHERE id = 'owner';
		INSERT INTO routing_rules (id, user_id, domain_id, scope, pattern, mailbox_id, action, forward_to, keep_copy, created_at)
		VALUES ('fw', 'owner', 'd1', 'mailbox', '*', 'mb1', 'forward', 'rule@far.test', 1, 1);
	`);
	const input = { from: "a@b.test", to: "owner@one.test", raw: new TextEncoder().encode("Subject: x\r\n\r\nhi").buffer, headers: { subject: "x" } };

	const ok = intakeFixture(database);
	const result = await intakeIncomingMail(ok.env, input, { forward: async (destination) => { ok.events.push(`forward ${destination}`); return true; } });
	assert.equal(result.action, "store");
	assert.equal(result.forwardedTo, "rule@far.test");
	assert.deepEqual(ok.events, ["put inbound/", "enqueue", "forward rule@far.test", "forward account@far.test"]);

	const down = intakeFixture(database, { failPut: true });
	await assert.rejects(intakeIncomingMail(down.env, input, { forward: async (destination) => { down.events.push(`forward ${destination}`); return true; } }), /R2 down/);
	assert.deepEqual(down.events, ["put inbound/"], "nothing was forwarded before the failure");

	const throwing = intakeFixture(database);
	const stored = await intakeIncomingMail(throwing.env, input, { forward: async () => { throw new Error("relay down"); } });
	assert.equal(stored.action, "store", "a forward failing after the copy is queued does not fail the delivery");
	assert.equal(stored.forwardedTo, null);
});

test("a forward rule without a kept copy still forwards first and stores nothing when it succeeds", async (t) => {
	const { database } = await fixture(t);
	database.db.exec(`
		INSERT INTO routing_rules (id, user_id, domain_id, scope, pattern, mailbox_id, action, forward_to, keep_copy, created_at)
		VALUES ('fw', 'owner', 'd1', 'mailbox', '*', 'mb1', 'forward', 'rule@far.test', 0, 1);
	`);
	const input = { from: "a@b.test", to: "owner@one.test", raw: new TextEncoder().encode("Subject: x\r\n\r\nhi").buffer, headers: { subject: "x" } };
	const ok = intakeFixture(database);
	const result = await intakeIncomingMail(ok.env, input, { forward: async (destination) => { ok.events.push(`forward ${destination}`); return true; } });
	assert.deepEqual(result, { action: "forward", forwardedTo: "rule@far.test" });
	assert.deepEqual(ok.events, ["forward rule@far.test"]);
	const failed = intakeFixture(database);
	const stored = await intakeIncomingMail(failed.env, input, { forward: async () => false });
	assert.equal(stored.action, "store");
	assert.deepEqual(failed.events, ["put inbound/", "enqueue"]);
});

test("the List-Unsubscribe read is skipped only where the inbound pipeline recorded its absence", () => {
	assert.equal(mayHaveUnsubscribeHeader({ rawR2Key: "inbound/abc.eml", hasUnsubscribe: false }), false);
	assert.equal(mayHaveUnsubscribeHeader({ rawR2Key: "inbound/abc.eml", hasUnsubscribe: true }), true);
	assert.equal(mayHaveUnsubscribeHeader({ rawR2Key: "imports/msg.eml", hasUnsubscribe: false }), true);
	assert.equal(mayHaveUnsubscribeHeader({ rawR2Key: "drafts/msg.eml", hasUnsubscribe: false }), true);
	assert.equal(mayHaveUnsubscribeHeader({ rawR2Key: null, hasUnsubscribe: true }), false);
});
