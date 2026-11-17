import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { and, eq, gt, inArray } from "drizzle-orm";
import { build } from "esbuild";
import { normalizeCounts, runCounterScenario, seedCounterAccounts } from "./fixtures/message-counters-scenario.mjs";

// Sidebar counts and JMAP Mailbox/get read message_counters, kept by the triggers of migration
// 0089 (PostgreSQL/MySQL 0013). The response must stay what the old GROUP BY over every message
// produced; these tests drive random writes and compare the two on SQLite and on PostgreSQL.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(root, "tests", ".tmp-message-counters-"));
after(() => rmSync(outDir, { recursive: true, force: true }));

const options = {
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node22",
	tsconfig: join(root, "tsconfig.json"),
	external: ["better-sqlite3", "drizzle-orm", "drizzle-orm/*", "@electric-sql/*", "pg", "postgres", "mysql2", "mysql2/*", "@neondatabase/*", "@planetscale/*", "@libsql/*"],
	logLevel: "silent",
};
await build({
	...options,
	stdin: {
		contents: `
			export { loadMessageCounts, loadGroupedMessageCounts } from "./src/app/api/messages/counts/load";
			export { buildMessageCounts, withLiveSnoozedRows } from "./src/app/api/messages/counts/utils";
			export { loadCounterRows, rebuildMessageCounters, runMessageCounterRebuild } from "./src/lib/messages/counters";
			export { mergeCounterRows, messageCounterRebuildStatements } from "./src/lib/messages/counters-utils";
			export { exportDatabaseRecords, restoreDatabaseRecords } from "./src/lib/backups/export";
			export { schemaDialect } from "./src/db/dialect";
			export { createDb, getDb, schema } from "./src/db";
			export { getDatabaseConfig } from "./src/db/with-database";
			export { openExternalDatabase } from "./src/db/external";
			export { applyPendingMigrations } from "./src/lib/migrations/service";
		`,
		resolveDir: root,
		loader: "ts",
	},
	outfile: join(outDir, "counters.mjs"),
});
await build({
	...options,
	entryPoints: {
		database: join(root, "server/runtime/sqlite-database.ts"),
		migrate: join(root, "server/runtime/migrate.ts"),
	},
	outdir: outDir,
	outExtension: { ".js": ".mjs" },
});

const load = (name) => import(pathToFileURL(join(outDir, `${name}.mjs`)).href);
const app = await load("counters");
const { SqliteDatabase } = await load("database");
const { applyMigrations } = await load("migrate");

async function migratedDatabase(t, { nodeOrder = false } = {}) {
	const database = new SqliteDatabase(join(outDir, `${crypto.randomUUID()}.sqlite`));
	t.after(() => database.db.close());
	if (nodeOrder) {
		// The self-hosted server's order: journal entries first, then unlisted files by name.
		await applyMigrations(database, join(root, "drizzle/migrations"));
	} else {
		// The bundle, in file-name order, as Workers and /api/setup apply it.
		const applied = await app.applyPendingMigrations(database);
		assert.ok(applied.ready, JSON.stringify(applied));
	}
	const db = app.getDb({ DB: database });
	await seedCounterAccounts(db, app.schema);
	return { database, db };
}

// --- pure folding ---

test("a key naming a deleted folder folds into no folder and nets out", () => {
	const base = { mailboxId: "mb1", direction: "inbound", status: "received", read: false, starred: false };
	const rows = app.mergeCounterRows([
		{ ...base, folderKey: "gone", folderExists: 0, total: 3 },
		{ ...base, folderKey: "", folderExists: 0, total: -1 },
		{ ...base, folderKey: "f1", folderExists: 1, total: 2 },
		{ ...base, folderKey: "f2", folderExists: 1, total: 0 },
		{ ...base, mailboxId: "mb0", folderKey: "", folderExists: 0, total: 1 },
	]);
	assert.deepEqual(rows, [
		{ ...base, mailboxId: "mb0", folderId: null, total: 1 },
		{ ...base, folderId: "f1", total: 2 },
		{ ...base, folderId: null, total: 2 },
	]);
});

test("snoozed groups leave their folder for Snoozed without changing other figures", () => {
	const tallies = [
		{ mailboxId: "mb1", folderId: null, direction: "inbound", status: "received", read: false, starred: true, total: 5 },
		{ mailboxId: "mb1", folderId: "f1", direction: "inbound", status: "received", read: true, starred: false, total: 2 },
	];
	const snoozed = [
		{ mailboxId: "mb1", folderId: null, direction: "inbound", status: "received", read: false, starred: true, total: 2 },
		{ mailboxId: "mb1", folderId: "f1", direction: "inbound", status: "received", read: true, starred: false, total: 1 },
	];
	const counts = app.buildMessageCounts(app.withLiveSnoozedRows(tallies, snoozed));
	const future = new Date(Date.now() + 86_400_000);
	const expected = app.buildMessageCounts([
		{ ...tallies[0], snoozedUntil: null, total: 3 },
		{ ...tallies[0], snoozedUntil: future, total: 2 },
		{ ...tallies[1], snoozedUntil: null, total: 1 },
		{ ...tallies[1], snoozedUntil: future, total: 1 },
	]);
	assert.deepEqual(counts, expected);
	assert.deepEqual(counts.folders.snoozed, { total: 3, unread: 2 });
	assert.deepEqual(counts.folders.inbox, { total: 3, unread: 3 });
	assert.deepEqual(counts.folders.starred, { total: 5, unread: 5 });
	assert.deepEqual(counts.customFolders, { f1: { total: 2, unread: 0 } });
	assert.deepEqual(counts.mailboxes, [{ mailboxId: "mb1", total: 7, unread: 5, inbox: 3 }]);
});

// --- SQLite, through the real migrations and triggers ---

for (const seed of [1, 2, 3]) {
	test(`SQLite: counters match the grouped query after random writes (seed ${seed})`, async (t) => {
		const { db } = await migratedDatabase(t);
		const result = await runCounterScenario(db, app.schema, app, { seed, steps: 400, every: 20 });
		assert.deepEqual(result.mismatches.slice(0, 1), []);
		assert.ok(result.checks >= 20);
		assert.ok(result.messageRows > 50, `only ${result.messageRows} messages were left`);
	});
}

test("SQLite: a fresh database migrated in the self-hosted server's order counts right too", async (t) => {
	const { database, db } = await migratedDatabase(t, { nodeOrder: true });
	const names = database.db.prepare("SELECT name FROM d1_migrations ORDER BY id").all().map((row) => row.name);
	assert.ok(names.indexOf("0089_add_message_counters.sql") > names.indexOf("0051_add_primary_admin.sql"), names.slice(-4).join(", "));
	const result = await runCounterScenario(db, app.schema, app, { seed: 4, steps: 300, every: 25 });
	assert.deepEqual(result.mismatches.slice(0, 1), []);
});

test("SQLite: the migration backfills messages that existed before it", async (t) => {
	const { migrations } = JSON.parse(readFileSync(join(root, "src/lib/migrations/bundle.json"), "utf8"));
	const index = migrations.findIndex((migration) => migration.name.startsWith("0089_"));
	assert.ok(index > 0);
	const database = new SqliteDatabase(":memory:");
	t.after(() => database.db.close());
	for (const migration of migrations.slice(0, index)) for (const statement of migration.statements) database.db.exec(statement);
	const db = app.getDb({ DB: database });
	await seedCounterAccounts(db, app.schema);
	const { messages } = app.schema;
	const rows = Array.from({ length: 60 }, (_, n) => ({
		id: `old${n}`,
		userId: "u1",
		mailboxId: ["mb1", "mb2", "mb3", null][n % 4],
		folderId: n % 5 === 0 ? "f1" : null,
		direction: n % 3 === 0 ? "outbound" : "inbound",
		fromAddr: "a@example.com",
		toAddr: "b@example.com",
		status: ["received", "sent", "archived", "trash"][n % 4],
		read: n % 2 === 0,
		starred: n % 7 === 0,
		snoozedUntil: n % 6 === 0 ? new Date(Date.now() + 86_400_000) : null,
	}));
	await db.insert(messages).values(rows);
	for (const migration of migrations.slice(index)) for (const statement of migration.statements) database.db.exec(statement);

	const ids = ["mb1", "mb2", "mb3"];
	assert.deepEqual(
		normalizeCounts(await app.loadMessageCounts(db, { mailboxIds: ids })),
		normalizeCounts(await app.loadGroupedMessageCounts(db, inArray(messages.mailboxId, ids))),
	);
});

test("SQLite: restoring a backup leaves every restored message counted once", async (t) => {
	const { database, db } = await migratedDatabase(t);
	const result = await runCounterScenario(db, app.schema, app, { seed: 11, steps: 200, every: 50 });
	assert.deepEqual(result.mismatches.slice(0, 1), []);
	const { messages } = app.schema;
	const ids = result.mailboxIds;
	const before = normalizeCounts(await app.loadGroupedMessageCounts(db, inArray(messages.mailboxId, ids)));

	const backup = await app.exportDatabaseRecords(database);
	const document = JSON.parse(new TextDecoder().decode(backup));
	assert.equal(document.tables.message_counters, undefined, "tallies are derived and not exported");
	// Stale tallies, as MySQL leaves them when the users cascade fires no triggers.
	database.db.exec("UPDATE message_counters SET total = total + 5");
	await app.restoreDatabaseRecords(database, backup.buffer.slice(backup.byteOffset, backup.byteOffset + backup.byteLength));

	assert.deepEqual(normalizeCounts(await app.loadMessageCounts(db, { mailboxIds: ids })), before);
	assert.deepEqual(normalizeCounts(await app.loadGroupedMessageCounts(db, inArray(messages.mailboxId, ids))), before);
});

test("SQLite: before migration 0089 the counts fall back to grouping", async (t) => {
	const { database, db } = await migratedDatabase(t);
	await runCounterScenario(db, app.schema, app, { seed: 5, steps: 80, every: 80 });
	database.db.exec("DROP TABLE message_counters");
	const { messages } = app.schema;
	const ids = ["mb1", "mb2"];
	assert.deepEqual(
		normalizeCounts(await app.loadMessageCounts(db, { mailboxIds: ids })),
		normalizeCounts(await app.loadGroupedMessageCounts(db, inArray(messages.mailboxId, ids))),
	);
});

test("SQLite: a folder deleted without triggers, as MySQL's foreign keys do, still counts right", async (t) => {
	const { database, db } = await migratedDatabase(t);
	const { messages } = app.schema;
	await db.insert(messages).values(Array.from({ length: 12 }, (_, n) => ({
		id: `m${n}`,
		userId: "u1",
		mailboxId: "mb1",
		folderId: n % 2 ? "f1" : null,
		direction: "inbound",
		fromAddr: "a@example.com",
		toAddr: "b@example.com",
		status: "received",
		read: n % 3 === 0,
		starred: n % 4 === 0,
	})));
	// MySQL runs ON DELETE SET NULL without firing the messages triggers.
	const triggers = database.db.prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'message_counters_au_%'").all();
	assert.equal(triggers.length, 2);
	database.db.exec("DROP TRIGGER message_counters_au_old; DROP TRIGGER message_counters_au_new; PRAGMA foreign_keys = OFF;");
	database.db.exec("DELETE FROM folders WHERE id = 'f1'; UPDATE messages SET folder_id = NULL WHERE folder_id = 'f1';");
	database.db.exec("PRAGMA foreign_keys = ON;");
	for (const { sql } of triggers) database.db.exec(sql);
	assert.ok(database.db.prepare("SELECT total FROM message_counters WHERE folder_key = 'f1'").all().length > 0, "the stale key is left behind");

	await db.update(messages).set({ read: true }).where(eq(messages.mailboxId, "mb1"));
	await db.delete(messages).where(inArray(messages.id, ["m1", "m4"]));
	await db.update(messages).set({ status: "archived" }).where(eq(messages.id, "m3"));
	assert.deepEqual(
		normalizeCounts(await app.loadMessageCounts(db, { mailboxIds: ["mb1"] })),
		normalizeCounts(await app.loadGroupedMessageCounts(db, inArray(messages.mailboxId, ["mb1"]))),
	);
	const tallies = await app.loadCounterRows(db, ["mb1"]);
	assert.ok(tallies.every((row) => row.folderId === null && row.total > 0));
});

// MySQL fires no triggers for foreign key cascades: purging an account deletes its messages (in
// mailboxes it shared too) without taking them out of the tallies. The daily cron rebuilds them.
for (const dialect of ["sqlite", "mysql"]) {
	test(`SQLite: the ${dialect} counter rebuild repairs tallies a trigger-less cascade left stale`, async (t) => {
		const { database, db } = await migratedDatabase(t);
		const result = await runCounterScenario(db, app.schema, app, { seed: 13, steps: 150, every: 150 });
		assert.deepEqual(result.mismatches.slice(0, 1), []);
		const { messages, folders } = app.schema;
		const ids = result.mailboxIds;
		const [folder] = await db.select({ id: folders.id }).from(folders).where(eq(folders.mailboxId, "mb1")).limit(1);
		// Another account's mail in mb1, which u1 owns (the scenario never deletes mb1).
		await db.insert(messages).values(Array.from({ length: 9 }, (_, n) => ({
			id: `guest${n}`,
			userId: "u2",
			mailboxId: n % 3 === 0 ? ids[ids.length - 1] : "mb1",
			folderId: n % 4 === 0 && folder ? folder.id : null,
			direction: n % 2 ? "outbound" : "inbound",
			fromAddr: "two@example.com",
			toAddr: "one@example.com",
			status: n % 2 ? "sent" : "received",
			read: n % 3 === 1,
			starred: n === 4,
		})));
		const grouped = async () => normalizeCounts(await app.loadGroupedMessageCounts(db, inArray(messages.mailboxId, ids)));
		const counted = async () => normalizeCounts(await app.loadMessageCounts(db, { mailboxIds: ids }));

		// The cascade from users, as MySQL runs it: no delete trigger fires.
		const [trigger] = database.db.prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'message_counters_ad'").all();
		assert.ok(trigger);
		database.db.exec("DROP TRIGGER message_counters_ad; DELETE FROM messages WHERE user_id = 'u2';");
		database.db.exec(trigger.sql);
		// A key no message has any more, and a total that drifted.
		database.db.exec("INSERT INTO message_counters (mailbox_id, folder_key, direction, status, read, starred, total) VALUES ('mb2', '', 'inbound', 'spam', 1, 1, 4) ON CONFLICT DO UPDATE SET total = total + 4");
		database.db.exec("UPDATE message_counters SET total = total + 2 WHERE rowid IN (SELECT rowid FROM message_counters ORDER BY rowid LIMIT 3)");
		assert.notDeepEqual(await counted(), await grouped(), "the tallies are stale");

		// The cron leaves SQLite alone: its triggers see cascades.
		assert.equal(await app.runMessageCounterRebuild({ DB: database }), false);
		assert.notDeepEqual(await counted(), await grouped());

		await app.rebuildMessageCounters(database, dialect);
		assert.deepEqual(await counted(), await grouped());
		const stale = database.db.prepare("SELECT count(*) AS n FROM message_counters WHERE total <= 0").get();
		assert.equal(stale.n, 0, "a rebuild holds only keys in use");

		// Triggers keep working from the rebuilt rows.
		await db.update(messages).set({ read: true }).where(eq(messages.mailboxId, "mb1"));
		await db.delete(messages).where(eq(messages.mailboxId, "mb2"));
		assert.deepEqual(await counted(), await grouped());
	});
}

test("the rebuild recounts with the backfill of each dialect's migration", () => {
	const flat = (text) => text.replace(/[`"]/g, "").replace(/\s+/g, " ").replace(/\s*;\s*$/, "").trim();
	const backfill = (path) => {
		const text = readFileSync(join(root, path), "utf8");
		const statement = text.split("--> statement-breakpoint").find((part) => /INSERT INTO\s+[`"]?message_counters/.test(part) && /GROUP BY/.test(part));
		return flat(statement.replace(/^\s*--.*$/gm, ""));
	};
	const sources = { sqlite: "drizzle/migrations/0089_add_message_counters.sql", postgres: "drizzle/migrations-pg/0013_message_counters.sql", mysql: "drizzle/migrations-mysql/0013_message_counters.sql" };
	for (const [dialect, path] of Object.entries(sources)) {
		const [clear, insert] = app.messageCounterRebuildStatements(dialect);
		assert.equal(clear, "DELETE FROM message_counters");
		assert.equal(flat(insert), backfill(path), dialect);
	}
	assert.match(app.messageCounterRebuildStatements("mysql")[1], /`read`/);
	assert.match(app.messageCounterRebuildStatements("postgres")[1], /"read"/);
});

test("SQLite: the live queries are index ranges, not mailbox scans", async (t) => {
	const { database, db } = await migratedDatabase(t);
	const { messages } = app.schema;
	const plan = (query) => {
		const { sql, params } = query.toSQL();
		return database.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params.map((value) => (typeof value === "boolean" ? Number(value) : value))).map((row) => row.detail).join("\n");
	};
	// The same columns and predicate as the snoozed query in loadMessageCounts.
	const snoozedPlan = plan(
		db.select({ mailboxId: messages.mailboxId, folderId: messages.folderId, direction: messages.direction, status: messages.status, read: messages.read, starred: messages.starred })
			.from(messages)
			.where(and(inArray(messages.mailboxId, ["mb1", "mb2"]), gt(messages.snoozedUntil, new Date()))),
	);
	assert.match(snoozedPlan, /COVERING INDEX messages_mailbox_snoozed_idx \(mailbox_id=\? AND snoozed_until>\?\)/);
	const scheduledPlan = plan(db.select({ id: messages.id }).from(messages).where(and(inArray(messages.mailboxId, ["mb1", "mb2"]), eq(messages.direction, "outbound"), eq(messages.status, "queued"))));
	assert.match(scheduledPlan, /\(mailbox_id=\? AND status=\?/);
	const counterPlan = plan(db.select().from(app.schema.messageCounters).where(eq(app.schema.messageCounters.mailboxId, "mb1")));
	assert.match(counterPlan, /message_counters_key_idx/);
});

// --- PostgreSQL (PGlite), through migrations-pg/0013 and its plpgsql trigger ---

test("PostgreSQL: counters match the grouped query after random writes", () => {
	const result = spawnSync(process.execPath, [join(root, "tests/fixtures/message-counters-postgres-runner.mjs"), join(outDir, "counters.mjs"), "7", "250"], {
		env: { ...process.env, MAILCLAW_DB_DIALECT: "postgres", DATABASE_URL: "", DATABASE_DRIVER: "" },
		encoding: "utf8",
		timeout: 170_000,
	});
	assert.equal(result.status, 0, result.stderr || result.error?.message);
	const output = JSON.parse(result.stdout);
	assert.equal(output.dialect, "postgres");
	assert.deepEqual(output.mismatches, []);
	assert.ok(output.checks >= 10);
	assert.ok(output.messageRows > 30, `only ${output.messageRows} messages were left`);
});
