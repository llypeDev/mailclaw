import assert from "node:assert/strict";
import test, { after, mock } from "node:test";
import { loadAppWithSqlite, recordingBucket, seconds, DAY_MS } from "./helpers/app-sqlite.mjs";

// src/lib/backups against a migrated SQLite database: what a backup document holds (and leaves out),
// the restore round trip into a fresh and into a populated database, the backup runner writing to the
// bucket, the daily/weekly schedule, retention and deletion. Nothing is stubbed but the bucket.
const app = await loadAppWithSqlite({
	name: "backups",
	exports: [
		`export * from "./src/lib/backups/export.ts";`,
		`export * from "./src/lib/backups/runner.ts";`,
		`export * from "./src/lib/backups/service.ts";`,
		`export { BACKUP_PREFIX } from "./src/lib/backups/utils.ts";`,
	],
});
after(app.dispose);
const lib = app.lib;

/** The recording bucket, plus the `size` R2 reports for a put and a `get` for reading a backup back. */
function backupBucket() {
	const bucket = recordingBucket();
	const put = bucket.put;
	bucket.failPut = null;
	bucket.put = async (key, value, options) => {
		if (bucket.failPut) throw bucket.failPut;
		await put(key, value, options);
		return { key, size: value.byteLength };
	};
	bucket.get = async (key) => (bucket.objects.has(key) ? { arrayBuffer: async () => bucket.objects.get(key).buffer } : null);
	return bucket;
}

async function fixture(t, { seed = true } = {}) {
	const database = await app.openDatabase(t);
	const sql = database.db;
	const bucket = backupBucket();
	const env = { DB: database, BUCKET: bucket };
	const now = seconds(new Date());
	const count = (table, where = "1 = 1", ...params) => sql.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${where}`).get(...params).n;
	const addMessage = (id, subject, textBody) => {
		sql.prepare(
			"INSERT INTO messages (id, mailbox_id, user_id, direction, from_addr, to_addr, subject, text_body, status, created_at) VALUES (?, 'mb1', 'u1', 'inbound', 'anna@example.org', 'u1@example.com', ?, ?, 'received', ?)",
		).run(id, subject, textBody, now);
	};
	if (seed) {
		sql.prepare("INSERT INTO users (id, email, name, password_hash, created_at) VALUES ('u1', 'u1@example.com', 'Una', 'x', ?)").run(now);
		sql.prepare("INSERT INTO domains (id, user_id, hostname, zone_id, created_at) VALUES ('d1', 'u1', 'example.com', 'zone', ?)").run(now);
		sql.prepare("INSERT INTO mailboxes (id, user_id, domain_id, local_part, type, created_at) VALUES ('mb1', 'u1', 'd1', 'u1', 'personal', ?)").run(now);
		addMessage("m1", "Quarterly invoice", "Please find the quarterly invoice attached.");
		addMessage("m2", "Lunch", "Pizza on Friday?");
		sql.prepare("INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES ('s1', 'u1', 'hash-s1', ?, ?)").run(now + 3600, now);
		// Rows in tables a backup deliberately leaves out.
		sql.prepare("INSERT INTO push_subscriptions (id, user_id, session_id, endpoint, p256dh, auth, created_at, updated_at) VALUES ('ps1', 'u1', 's1', 'https://push.example/1', 'k', 'a', ?, ?)").run(now, now);
		sql.prepare("INSERT INTO import_jobs (id, user_id, mailbox_id, kind, label, spec, created_at, updated_at) VALUES ('ij1', 'u1', 'mb1', 'file', 'mbox', '{}', ?, ?)").run(now, now);
		sql.prepare("INSERT INTO webauthn_challenges (id, ceremony_hash, challenge, purpose, user_id, binding_hash, expires_at, created_at) VALUES ('wc1', 'ch', 'c', 'login', 'u1', 'b', ?, ?)").run(now + 60, now);
	}
	const tableRows = (table) => sql.prepare(`SELECT * FROM ${table}`).all().map((row) => JSON.stringify(row)).sort();
	const search = (term) => sql.prepare("SELECT m.id FROM messages_fts JOIN messages m ON m.rowid = messages_fts.rowid WHERE messages_fts MATCH ? ORDER BY m.id").all(term).map((row) => row.id);
	return { database, sql, bucket, env, now, count, addMessage, tableRows, search };
}

const decode = (bytes) => JSON.parse(new TextDecoder().decode(bytes));

test("a backup holds every listed table and none of the derived, transient or internal ones", async (t) => {
	const f = await fixture(t);
	// The derived tables really have rows, so leaving them out is a choice, not an accident.
	for (const table of ["message_counters", "jmap_mailbox_revisions", "jmap_changes", "push_subscriptions", "import_jobs", "webauthn_challenges", "d1_migrations"]) {
		assert.ok(f.count(table) > 0, `${table} has rows`);
	}
	assert.ok(f.sql.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'messages_fts%'").all().length > 1);

	const document = decode(await lib.exportDatabaseRecords(f.env.DB));
	assert.equal(document.format, "mailclaw-database-backup");
	assert.equal(document.version, 2);
	assert.ok(!Number.isNaN(Date.parse(document.createdAt)));
	assert.deepEqual(document.includedTables, lib.BACKUP_TABLES);
	assert.deepEqual(Object.keys(document.tables), lib.BACKUP_TABLES);
	for (const table of lib.INTERNAL_TABLES) assert.ok(!(table in document.tables), table);
	assert.ok(!Object.keys(document.tables).some((table) => table.startsWith("messages_fts") || table.startsWith("sqlite_")));
	assert.deepEqual(document.tables.messages.map((row) => row.id).sort(), ["m1", "m2"]);
	assert.equal(document.tables.messages.find((row) => row.id === "m1").text_body, "Please find the quarterly invoice attached.");
	assert.deepEqual(document.tables.sessions.map((row) => row.id), ["s1"]);
	assert.equal(document.tables.users[0].email, "u1@example.com");

	const partial = decode(await lib.exportDatabaseRecords(f.env.DB, ["mail", "drive"]));
	assert.ok(!partial.includedTables.includes("messages"));
	assert.ok(!partial.includedTables.includes("drive_items"));
	assert.ok(partial.includedTables.includes("users"));
	assert.deepEqual(Object.keys(partial.tables), partial.includedTables);
	await assert.rejects(lib.exportDatabaseRecords(f.env.DB, ["accounts", "mail", "automation", "assistant", "drive", "system"]), /Select at least one backup table group/);
});

test("a table nobody listed aborts the backup; D1's own and the search index's do not", async (t) => {
	const f = await fixture(t, { seed: false });
	f.sql.exec("CREATE TABLE _cf_METADATA (key INTEGER PRIMARY KEY, value BLOB)");
	f.sql.exec("CREATE TABLE messages_fts_scratch (x)");
	f.sql.exec("ANALYZE");
	const covered = await lib.assertBackupTablesCoverDatabase(f.env.DB);
	assert.ok(covered.has("messages"));
	assert.ok(!covered.has("_cf_METADATA"));
	assert.ok(!covered.has("d1_migrations"));
	f.sql.exec("CREATE TABLE gadgets (id TEXT PRIMARY KEY)");
	await assert.rejects(lib.exportDatabaseRecords(f.env.DB), /Backup aborted: gadgets not listed in BACKUP_TABLES/);
});

test("restoring into a fresh database reproduces every table, the counters and the search index", async (t) => {
	const source = await fixture(t);
	const content = await lib.exportDatabaseRecords(source.env.DB);
	const target = await fixture(t, { seed: false });
	await lib.restoreDatabaseRecords(target.env.DB, content);

	for (const table of lib.BACKUP_TABLES) assert.deepEqual(target.tableRows(table), source.tableRows(table), table);
	assert.deepEqual(target.tableRows("message_counters"), source.tableRows("message_counters"));
	assert.deepEqual(target.search("quarterly"), ["m1"]);
	assert.deepEqual(target.search("pizza"), ["m2"]);
	// Transient tables are not restored.
	for (const table of ["push_subscriptions", "import_jobs", "webauthn_challenges"]) assert.equal(target.count(table), 0, table);
});

test("restoring over a populated database replaces its rows and counts each message once", async (t) => {
	const f = await fixture(t);
	const content = await lib.exportDatabaseRecords(f.env.DB);
	const before = Object.fromEntries(lib.BACKUP_TABLES.map((table) => [table, f.tableRows(table)]));
	const counters = f.tableRows("message_counters");

	f.addMessage("m3", "Later", "Written after the backup");
	f.sql.prepare("UPDATE messages SET subject = 'Changed' WHERE id = 'm1'").run();
	f.sql.prepare("INSERT INTO users (id, email, name, password_hash, created_at) VALUES ('u2', 'u2@example.com', 'Two', 'x', ?)").run(f.now);
	await lib.restoreDatabaseRecords(f.env.DB, content);

	for (const table of lib.BACKUP_TABLES) assert.deepEqual(f.tableRows(table), before[table], table);
	assert.deepEqual(f.tableRows("message_counters"), counters);
	assert.deepEqual(f.search("later"), []);
	assert.deepEqual(f.search("quarterly"), ["m1"]);
});

test("restore refuses partial and foreign files and upgrades a format 1 document", async (t) => {
	const f = await fixture(t);
	const encode = (value) => new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value));
	await assert.rejects(lib.restoreDatabaseRecords(f.env.DB, encode("not json")), /not a valid Mailclaw backup/);
	await assert.rejects(lib.restoreDatabaseRecords(f.env.DB, encode({ format: "other", version: 2, tables: {} })), /not a valid Mailclaw backup/);
	await assert.rejects(lib.restoreDatabaseRecords(f.env.DB, await lib.exportDatabaseRecords(f.env.DB, ["drive"])), /selected table groups only/);
	assert.equal(f.count("messages"), 2, "a refused restore touched nothing");

	// Format 1: no includedTables, and users from before require_second_factor existed.
	const legacy = decode(await lib.exportDatabaseRecords(f.env.DB));
	legacy.version = 1;
	delete legacy.includedTables;
	for (const table of ["drive_items", "drive_upload_parts", "drive_shares", "follow_ups", "message_tracking"]) delete legacy.tables[table];
	Object.assign(legacy.tables.users[0], { totp_enabled: 1, totp_secret: "JBSWY3DPEHPK3PXP" });
	delete legacy.tables.users[0].require_second_factor;
	await lib.restoreDatabaseRecords(f.env.DB, encode(legacy));
	assert.deepEqual(f.sql.prepare("SELECT totp_enabled, require_second_factor FROM users").all(), [{ totp_enabled: 1, require_second_factor: 1 }]);
	assert.equal(f.count("messages"), 2);
});

test("the runner writes the backup to the bucket and records where it went", async (t) => {
	const f = await fixture(t);
	await lib.updateBackupSettings(f.env, { enabled: false, scheduleType: "daily", scheduleValue: null, retentionEnabled: false, retentionDays: 30, excludedTableGroups: ["assistant", "drive"] });
	const id = await lib.createBackupRecord(f.env, "manual", "u1");
	assert.match(id, /^bak/);
	await lib.runDatabaseBackup(f.env, id);

	const row = f.sql.prepare("SELECT * FROM backups WHERE id = ?").get(id);
	assert.equal(row.status, "completed");
	assert.equal(row.trigger, "manual");
	assert.equal(row.created_by_user_id, "u1");
	assert.match(row.filename, /^mailclaw-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.json$/);
	assert.equal(row.r2_key, `${lib.BACKUP_PREFIX}/${id}/${row.filename}`);
	assert.ok(row.started_at && row.completed_at);
	assert.equal(row.error, null);
	const stored = f.bucket.objects.get(row.r2_key);
	assert.equal(row.size, stored.byteLength);
	assert.deepEqual(f.bucket.puts.map((put) => [put.key, put.options]), [[row.r2_key, { httpMetadata: { contentType: "application/json" }, customMetadata: { backupId: id } }]]);
	const document = decode(stored);
	assert.ok(!document.includedTables.includes("drive_items"));
	assert.ok(!document.includedTables.includes("agent_jobs"));
	assert.deepEqual(document.tables.messages.map((message) => message.id).sort(), ["m1", "m2"]);
	// The document restores as it was written (all groups this time).
	const full = await lib.createBackupRecord(f.env, "manual");
	await lib.updateBackupSettings(f.env, { enabled: false, scheduleType: "daily", scheduleValue: null, retentionEnabled: false, retentionDays: 30, excludedTableGroups: [] });
	await lib.runDatabaseBackup(f.env, full);
	const fullKey = f.sql.prepare("SELECT r2_key FROM backups WHERE id = ?").get(full).r2_key;
	const target = await fixture(t, { seed: false });
	await lib.restoreDatabaseRecords(target.env.DB, await (await f.bucket.get(fullKey)).arrayBuffer());
	assert.deepEqual(target.tableRows("messages"), f.tableRows("messages"));

	f.bucket.failPut = new Error("bucket unavailable");
	const failing = await lib.createBackupRecord(f.env, "manual");
	await assert.rejects(lib.runDatabaseBackup(f.env, failing), /bucket unavailable/);
	const failed = f.sql.prepare("SELECT status, error, completed_at, r2_key FROM backups WHERE id = ?").get(failing);
	assert.equal(failed.status, "failed");
	assert.equal(failed.error, "bucket unavailable");
	assert.ok(failed.completed_at);
	assert.equal(failed.r2_key, null);
});

// runDatabaseBackup exports while its own row is "running", so the document carries that row as
// running with no r2_key; once restored it can never be deleted and retention never picks it up.
test("a backup restored from its own file is not left in progress", async (t) => {
	const f = await fixture(t);
	const id = await lib.createBackupRecord(f.env, "manual");
	await lib.runDatabaseBackup(f.env, id);
	const key = f.sql.prepare("SELECT r2_key FROM backups WHERE id = ?").get(id).r2_key;
	await lib.restoreDatabaseRecords(f.env.DB, await (await f.bucket.get(key)).arrayBuffer());
	assert.deepEqual(f.sql.prepare("SELECT id FROM backups WHERE status IN ('queued', 'running')").all(), []);
	assert.equal(await lib.deleteBackup(f.env, id), true);
});

test("scheduled backups run once per UTC day, on the configured weekday, and only when enabled", async (t) => {
	const f = await fixture(t);
	const scheduled = () => f.sql.prepare("SELECT id, status, created_at FROM backups WHERE trigger = 'scheduled' ORDER BY created_at").all();
	const at = (iso) => {
		mock.timers.setTime(Date.parse(iso));
		return new Date();
	};
	mock.timers.enable({ apis: ["Date"], now: Date.parse("2030-01-01T03:00:00Z") });
	t.after(() => mock.timers.reset());

	// The migration seeds the settings switched off.
	assert.equal((await lib.getBackupSettings(f.env)).enabled, false);
	await lib.runScheduledDatabaseBackup(f.env, at("2030-01-01T03:00:00Z"));
	assert.deepEqual(scheduled(), []);

	await lib.updateBackupSettings(f.env, { enabled: true, scheduleType: "daily", scheduleValue: null, retentionEnabled: false, retentionDays: 30, excludedTableGroups: [] });
	await lib.runScheduledDatabaseBackup(f.env, at("2030-01-01T03:00:00Z"));
	await lib.runScheduledDatabaseBackup(f.env, at("2030-01-01T23:59:00Z"));
	assert.deepEqual(scheduled().map((row) => row.status), ["completed"]);
	await lib.runScheduledDatabaseBackup(f.env, at("2030-01-02T00:01:00Z"));
	assert.equal(scheduled().length, 2);

	// A failed run does not block a retry the same day.
	f.sql.prepare("UPDATE backups SET status = 'failed' WHERE created_at = ?").run(seconds(new Date("2030-01-02T00:01:00Z")));
	await lib.runScheduledDatabaseBackup(f.env, at("2030-01-02T06:00:00Z"));
	assert.deepEqual(scheduled().map((row) => row.status), ["completed", "failed", "completed"]);

	// Weekly on Friday (5): 2030-01-03 is a Thursday, 2030-01-04 a Friday.
	await lib.updateBackupSettings(f.env, { enabled: true, scheduleType: "weekly", scheduleValue: 5, retentionEnabled: false, retentionDays: 30, excludedTableGroups: [] });
	assert.equal(await lib.createScheduledBackupIfDue(f.env, at("2030-01-03T12:00:00Z")), null);
	assert.match(await lib.createScheduledBackupIfDue(f.env, at("2030-01-04T12:00:00Z")), /^bak/);
	assert.equal(await lib.createScheduledBackupIfDue(f.env, at("2030-01-04T13:00:00Z")), null, "already queued today");

	// Monthly on the 15th.
	await lib.updateBackupSettings(f.env, { enabled: true, scheduleType: "monthly", scheduleValue: 15, retentionEnabled: false, retentionDays: 30, excludedTableGroups: [] });
	assert.equal(await lib.createScheduledBackupIfDue(f.env, at("2030-01-14T12:00:00Z")), null);
	assert.match(await lib.createScheduledBackupIfDue(f.env, at("2030-01-15T12:00:00Z")), /^bak/);
});

test("retention deletes finished backups past the window, with their objects, and nothing else", async (t) => {
	const f = await fixture(t);
	const addBackup = (id, status, ageDays, r2Key = null) => {
		f.sql.prepare("INSERT INTO backups (id, status, trigger, r2_key, created_at) VALUES (?, ?, 'manual', ?, ?)").run(id, status, r2Key, seconds(new Date(Date.now() - ageDays * DAY_MS)));
		if (r2Key) f.bucket.objects.set(r2Key, new Uint8Array(1));
	};
	addBackup("old-done", "completed", 10, "backups/database/old-done/a.json");
	addBackup("old-failed", "failed", 10);
	addBackup("old-running", "running", 10, "backups/database/old-running/b.json");
	addBackup("old-queued", "queued", 10);
	addBackup("recent", "completed", 2, "backups/database/recent/c.json");
	const ids = () => f.sql.prepare("SELECT id FROM backups ORDER BY id").all().map((row) => row.id);

	assert.equal(await lib.deleteExpiredBackups(f.env), 0, "retention is off by default");
	await lib.updateBackupSettings(f.env, { enabled: false, scheduleType: "daily", scheduleValue: null, retentionEnabled: true, retentionDays: 7, excludedTableGroups: [] });
	assert.equal(await lib.deleteExpiredBackups(f.env), 2);
	assert.deepEqual(ids(), ["old-queued", "old-running", "recent"]);
	assert.deepEqual(f.bucket.deleted, ["backups/database/old-done/a.json"]);

	const listed = (await lib.listBackups(f.env)).map((backup) => backup.id);
	assert.equal(listed[0], "recent", "newest first");
	assert.deepEqual(listed.slice(1).sort(), ["old-queued", "old-running"]);
	await assert.rejects(lib.deleteBackup(f.env, "old-running"), /in progress cannot be deleted/);
	assert.equal(await lib.deleteBackup(f.env, "recent"), true);
	assert.deepEqual(f.bucket.deleted, ["backups/database/old-done/a.json", "backups/database/recent/c.json"]);
	assert.equal(await lib.deleteBackup(f.env, "recent"), false);
});

test("settings keep the excluded groups and ignore ones this version does not know", async (t) => {
	const f = await fixture(t, { seed: false });
	await lib.updateBackupSettings(f.env, { enabled: true, scheduleType: "weekly", scheduleValue: 1, retentionEnabled: true, retentionDays: 14, excludedTableGroups: ["mail", "drive"] });
	const settings = await lib.getBackupSettings(f.env);
	assert.deepEqual(
		{ enabled: settings.enabled, scheduleType: settings.scheduleType, scheduleValue: settings.scheduleValue, retentionEnabled: settings.retentionEnabled, retentionDays: settings.retentionDays, excludedTableGroups: settings.excludedTableGroups },
		{ enabled: true, scheduleType: "weekly", scheduleValue: 1, retentionEnabled: true, retentionDays: 14, excludedTableGroups: ["mail", "drive"] },
	);
	f.sql.prepare("UPDATE backup_settings SET excluded_table_groups = ?").run(JSON.stringify(["mail", "photos", 3]));
	assert.deepEqual((await lib.getBackupSettings(f.env)).excludedTableGroups, ["mail"]);
	f.sql.prepare("UPDATE backup_settings SET excluded_table_groups = 'not json'").run();
	assert.deepEqual((await lib.getBackupSettings(f.env)).excludedTableGroups, []);
});
