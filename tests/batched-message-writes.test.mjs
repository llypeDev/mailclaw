import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

// Permanent deletion (empty folder, bulk delete, trash retention) and the bulk spam / not-spam
// verdicts work in batches. These check that the batches keep the per-message results.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(root, "tests", ".tmp-batched-writes-"));
after(() => rmSync(outDir, { recursive: true, force: true }));

await build({
	entryPoints: {
		remove: join(root, "src/lib/email/permanent-delete.ts"),
		db: join(root, "src/db/index.ts"),
		feedback: join(root, "src/lib/spam/feedback.ts"),
		feedbackUtils: join(root, "src/lib/spam/feedback-utils.ts"),
		database: join(root, "server/runtime/sqlite-database.ts"),
		migrate: join(root, "server/runtime/migrate.ts"),
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

const load = (name) => import(pathToFileURL(join(outDir, `${name}.mjs`)).href);
const { permanentlyDeleteMessages } = await load("remove");
const { applySpamFeedback, applySpamFeedbackToMessages } = await load("feedback");
const { planSpamFeedback } = await load("feedbackUtils");
const { SqliteDatabase } = await load("database");
const { getDb } = await load("db");
const { applyMigrations } = await load("migrate");

const owner = { id: "u1", email: "kevin@example.com", role: "admin" };
const manage = { canManage: true, canRead: true };

async function createFixture(t) {
	const database = new SqliteDatabase(join(outDir, `${crypto.randomUUID()}.sqlite`));
	t.after(() => database.db.close());
	await applyMigrations(database, join(root, "drizzle/migrations"));
	database.db.exec(`
		INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES ('u1', 'kevin@example.com', 'Kevin', 'x', 'admin', 0);
		INSERT INTO domains (id, user_id, hostname, zone_id, created_at) VALUES ('d1', 'u1', 'example.com', 'zone', 0);
		INSERT INTO mailboxes (id, user_id, domain_id, local_part, created_at) VALUES ('mb1', 'u1', 'd1', 'kevin', 0), ('mb2', 'u1', 'd1', 'other', 0);
	`);
	const deleted = [];
	const bucketCalls = [];
	const bucket = {
		async delete(keys) {
			bucketCalls.push(keys);
			deleted.push(...(Array.isArray(keys) ? keys : [keys]));
		},
	};
	const queries = [];
	const prepare = database.prepare.bind(database);
	database.prepare = (sql) => {
		queries.push(sql);
		return prepare(sql);
	};
	const message = (id, { status = "trash", mailbox = "mb1", direction = "inbound", subject = "Cheap pills", text = "Buy cheap pills now at a discount" } = {}) => {
		database.db.prepare(`INSERT INTO messages (id, user_id, mailbox_id, direction, from_addr, to_addr, subject, text_body, status, raw_r2_key, created_at)
			VALUES (?, 'u1', ?, ?, 'seller@spam.example', 'kevin@example.com', ?, ?, ?, ?, 1)`).run(id, mailbox, direction, subject, text, status, `inbound/${id}.eml`);
	};
	const attachment = (id, messageId, key) => {
		database.db.prepare("INSERT INTO message_attachments (id, message_id, filename, content_type, size, r2_key, created_at) VALUES (?, ?, 'a.pdf', 'application/pdf', 1, ?, 1)").run(id, messageId, key);
	};
	return { database, env: { DB: database, BUCKET: bucket }, deleted, bucketCalls, queries, message, attachment };
}

test("permanent deletion removes rows and objects in batches and audits every message", async (t) => {
	const f = await createFixture(t);
	const rows = [];
	for (let index = 0; index < 200; index += 1) {
		const id = `m${String(index).padStart(3, "0")}`;
		f.message(id);
		f.attachment(`a${index}`, id, `attachments/${id}.pdf`);
		rows.push({ id, mailboxId: "mb1", rawR2Key: `inbound/${id}.eml`, status: "trash" });
	}
	// Saved to Drive: the Drive item points at the attachment's object, which must survive.
	f.database.db.prepare("INSERT INTO drive_items (id, owner_id, kind, name, r2_key, created_at, updated_at) VALUES ('d1', 'u1', 'file', 'a.pdf', 'attachments/m007.pdf', 1, 1)").run();
	f.queries.length = 0;

	assert.equal(await permanentlyDeleteMessages(f.env, getDb(f.env), "u1", rows, "empty"), 200);

	assert.equal(f.database.db.prepare("SELECT count(*) AS n FROM messages").get().n, 0);
	assert.equal(f.database.db.prepare("SELECT count(*) AS n FROM message_attachments").get().n, 0);
	assert.ok(!f.deleted.includes("attachments/m007.pdf"), "an object a Drive item uses stays");
	assert.ok(f.deleted.includes("attachments/m008.pdf"));
	for (const row of rows) assert.ok(f.deleted.includes(row.rawR2Key));
	const audits = f.database.db.prepare("SELECT metadata FROM audit_logs WHERE action = 'email.delete'").all().map((row) => JSON.parse(row.metadata));
	assert.equal(audits.length, 200);
	assert.deepEqual(audits.find((entry) => entry.messageId === "m010"), { permanent: true, source: "empty", messageId: "m010", previousStatus: "trash" });

	// Three batches (90 + 90 + 20): a handful of statements each instead of several per message.
	const rowDeletes = f.queries.filter((sql) => sql.startsWith('delete from "messages"'));
	assert.equal(rowDeletes.length, 3);
	assert.ok(f.queries.length < 60, `${f.queries.length} statements`);
	assert.ok(f.bucketCalls.length <= 6, `${f.bucketCalls.length} bucket calls`);
	for (const sql of f.queries) assert.ok((sql.match(/\?/g) ?? []).length <= 100, "every statement stays within D1's 100 bound parameters");
});

test("planSpamFeedback skips outbound mail, unmanaged mailboxes and repeats", () => {
	const plan = planSpamFeedback(
		[
			{ id: "new", mailboxId: "mb1", direction: "inbound" },
			{ id: "again", mailboxId: "mb1", direction: "inbound" },
			{ id: "flip", mailboxId: "mb1", direction: "inbound" },
			{ id: "sent", mailboxId: "mb1", direction: "outbound" },
			{ id: "shared", mailboxId: "mb2", direction: "inbound" },
			{ id: "orphan", mailboxId: null, direction: "inbound" },
		],
		new Map([["again", { classification: "spam" }], ["flip", { classification: "ham" }]]),
		"spam",
		(mailboxId) => mailboxId === "mb1",
	);
	assert.deepEqual(plan, { moveOnly: ["again"], train: [{ id: "new", mailboxId: "mb1" }, { id: "flip", mailboxId: "mb1" }] });
});

async function trainingState(f) {
	return {
		tokens: f.database.db.prepare("SELECT mailbox_id, token, spam_count, ham_count FROM spam_token_stats ORDER BY mailbox_id, token").all(),
		reputation: f.database.db.prepare("SELECT mailbox_id, type, key, messages_seen, spam_count, ham_count FROM spam_reputation ORDER BY mailbox_id, type, key").all(),
		feedback: f.database.db.prepare("SELECT message_id, classification, training_tokens FROM spam_feedback ORDER BY message_id").all(),
		messages: f.database.db.prepare("SELECT id, status, folder_id FROM messages ORDER BY id").all(),
		audits: f.database.db.prepare("SELECT message_id FROM audit_logs WHERE action = 'email.spam_feedback' ORDER BY message_id").all().map((row) => row.message_id),
	};
}

test("batched spam verdicts train exactly like one verdict per message", async (t) => {
	const single = await createFixture(t);
	const batched = await createFixture(t);
	const seed = (f) => {
		for (let index = 0; index < 100; index += 1) {
			f.message(`s${String(index).padStart(3, "0")}`, { status: "received", subject: `Offer ${index % 7}`, text: `Cheap pills ${index % 5} discount code ${index % 3}` });
		}
		f.message("outbound", { status: "sent", direction: "outbound" });
	};
	seed(single);
	seed(batched);
	const ids = [...Array.from({ length: 100 }, (_, index) => `s${String(index).padStart(3, "0")}`), "outbound"];

	// Spam, then not spam for part of them (retraining from stored tokens), then spam again (move only for repeats).
	for (const id of ids) await applySpamFeedback(single.env, owner, id, "spam", manage);
	for (const id of ids.slice(0, 30)) await applySpamFeedback(single.env, owner, id, "ham", manage);
	for (const id of ids.slice(0, 50)) await applySpamFeedback(single.env, owner, id, "spam", manage);

	const accessFor = () => manage;
	const applied = await applySpamFeedbackToMessages(batched.env, owner, ids, "spam", accessFor);
	assert.equal(applied.length, 100, "outbound mail is not trained");
	await applySpamFeedbackToMessages(batched.env, owner, ids.slice(0, 30), "ham", accessFor);
	batched.queries.length = 0;
	await applySpamFeedbackToMessages(batched.env, owner, ids.slice(0, 50), "spam", accessFor);

	const expected = await trainingState(single);
	const actual = await trainingState(batched);
	assert.deepEqual(actual.tokens, expected.tokens);
	assert.deepEqual(actual.reputation, expected.reputation);
	assert.deepEqual(actual.feedback, expected.feedback);
	assert.deepEqual(actual.messages, expected.messages);
	assert.deepEqual(actual.audits, expected.audits);
	assert.ok(!batched.queries.some((sql) => sql.includes('"text_body"')), "retraining reuses stored tokens and never reads bodies");
	for (const sql of batched.queries) assert.ok((sql.match(/\?/g) ?? []).length <= 100);
});

test("a spam verdict needs manage access to the message's mailbox", async (t) => {
	const f = await createFixture(t);
	f.message("theirs", { status: "received", mailbox: "mb2" });
	const applied = await applySpamFeedbackToMessages(f.env, owner, ["theirs"], "spam", (mailboxId) => (mailboxId === "mb2" ? { canManage: false, canRead: true } : manage));
	assert.deepEqual(applied, []);
	assert.equal(f.database.db.prepare("SELECT status FROM messages WHERE id = 'theirs'").get().status, "received");
	assert.equal(await applySpamFeedback(f.env, owner, "theirs", "spam", null), false);
});
