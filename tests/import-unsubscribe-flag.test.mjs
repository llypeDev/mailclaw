import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

// Imported mail decides `has_unsubscribe` when it is stored, under a key prefix that tells those
// rows from older imports, so opening one can skip the 64 KB raw header read like inbound mail.

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(root, "tests", ".tmp-import-unsubscribe-"));
after(() => rmSync(outDir, { recursive: true, force: true }));

await build({
	entryPoints: {
		service: join(root, "src/lib/import/service.ts"),
		unsubscribe: join(root, "src/lib/email/unsubscribe.ts"),
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
	external: ["better-sqlite3", "drizzle-orm", "drizzle-orm/*", "postal-mime"],
	logLevel: "silent",
});

const load = (name) => import(pathToFileURL(join(outDir, `${name}.mjs`)).href);
const { importMessagesToMailbox } = await load("service");
const { mayHaveUnsubscribeHeader, offersUnsubscribe, IMPORT_RAW_PREFIX, JMAP_DRAFT_RAW_PREFIX } = await load("unsubscribe");
const { SqliteDatabase } = await load("database");
const { applyMigrations } = await load("migrate");

const message = (id, extra = [], body = "Hello") => new TextEncoder().encode([
	"From: News <news@example.com>",
	"To: Iris <iris@example.org>",
	"Subject: Weekly",
	`Message-ID: <${id}@example.com>`,
	"Date: Tue, 2 Feb 2021 10:00:00 +0000",
	...extra,
	"",
	body,
].join("\r\n")).buffer;

test("the flag is trusted for inbound and new import prefixes, not for older imported rows", () => {
	assert.equal(mayHaveUnsubscribeHeader({ rawR2Key: "inbound/abc.eml", hasUnsubscribe: false }), false);
	assert.equal(mayHaveUnsubscribeHeader({ rawR2Key: `${IMPORT_RAW_PREFIX}msg.eml`, hasUnsubscribe: false }), false);
	assert.equal(mayHaveUnsubscribeHeader({ rawR2Key: `${IMPORT_RAW_PREFIX}msg.eml`, hasUnsubscribe: true }), true);
	assert.equal(mayHaveUnsubscribeHeader({ rawR2Key: `${JMAP_DRAFT_RAW_PREFIX}msg.eml`, hasUnsubscribe: false }), false);
	// Rows imported before the flag was set there still pay the read.
	assert.equal(mayHaveUnsubscribeHeader({ rawR2Key: "imports/msg_123.eml", hasUnsubscribe: false }), true);
	assert.equal(mayHaveUnsubscribeHeader({ rawR2Key: "drafts/msg_123.eml", hasUnsubscribe: false }), true);
	assert.equal(mayHaveUnsubscribeHeader({ rawR2Key: null, hasUnsubscribe: true }), false);
	assert.ok(IMPORT_RAW_PREFIX.startsWith("imports/") && JMAP_DRAFT_RAW_PREFIX.startsWith("drafts/"));
});

test("only inbound mail offers an unsubscribe, from its header or its body", () => {
	const header = message("h", ["List-Unsubscribe: <https://example.com/u>"]);
	const plain = message("p");
	assert.equal(offersUnsubscribe("inbound", header, null, "Hello"), true);
	assert.equal(offersUnsubscribe("inbound", plain, '<a href="https://example.com/u">Unsubscribe</a>', null), true);
	assert.equal(offersUnsubscribe("inbound", plain, null, "Hello"), false);
	assert.equal(offersUnsubscribe("outbound", header, null, "Hello"), false);
});

test("imports store under the new prefix and set has_unsubscribe as inbound mail does", async (t) => {
	const database = new SqliteDatabase(join(outDir, "import.sqlite"));
	t.after(() => database.db.close());
	await applyMigrations(database, join(root, "drizzle/migrations"));
	const now = Math.floor(Date.now() / 1000);
	database.db.prepare("INSERT INTO users (id, email, name, password_hash, created_at) VALUES ('u1', 'iris@example.org', 'Iris', 'x', ?)").run(now);
	database.db.prepare("INSERT INTO domains (id, user_id, hostname, zone_id, created_at) VALUES ('d1', 'u1', 'example.org', 'zone', ?)").run(now);
	database.db.prepare("INSERT INTO mailboxes (id, user_id, domain_id, local_part, created_at) VALUES ('mb1', 'u1', 'd1', 'iris', ?)").run(now);
	const stored = [];
	const env = { DB: database, BUCKET: { put: async (key) => stored.push(key), delete: async () => undefined } };

	const inbox = await importMessagesToMailbox(env, {
		userId: "u1",
		mailboxId: "mb1",
		destination: { type: "system", section: "inbox" },
		messages: [
			{ filename: "news.eml", raw: message("news", ["List-Unsubscribe: <https://example.com/u>"]) },
			{ filename: "plain.eml", raw: message("plain") },
		],
	});
	assert.deepEqual(inbox, { imported: 2, skipped: 0, errors: [] });
	const sent = await importMessagesToMailbox(env, {
		userId: "u1",
		mailboxId: "mb1",
		destination: { type: "system", section: "sent" },
		messages: [{ filename: "sent.eml", raw: message("sent", ["List-Unsubscribe: <https://example.com/u>"]) }],
	});
	assert.equal(sent.imported, 1);

	const rows = Object.fromEntries(database.db.prepare("SELECT provider_message_id AS id, raw_r2_key AS key, has_unsubscribe AS flag FROM messages").all().map((row) => [row.id, row]));
	assert.equal(rows["<news@example.com>"].flag, 1);
	assert.equal(rows["<plain@example.com>"].flag, 0);
	// Imported Sent mail is the user's own, so it never offers an unsubscribe.
	assert.equal(rows["<sent@example.com>"].flag, 0);
	for (const row of Object.values(rows)) assert.ok(row.key.startsWith(IMPORT_RAW_PREFIX), row.key);
	assert.deepEqual(stored.sort(), Object.values(rows).map((row) => row.key).sort());
	assert.equal(mayHaveUnsubscribeHeader({ rawR2Key: rows["<plain@example.com>"].key, hasUnsubscribe: false }), false);
});
