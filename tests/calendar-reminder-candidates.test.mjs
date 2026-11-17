import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildSchema0088App } from "./fixtures/schema-0088-app.mjs";
import { reminderCandidates } from "./fixtures/schema-0088-scenarios.mjs";

// src/lib/calendar/reminders.ts: the five-minute cron reads one-off events due within the longest offset and
// every running series, a page at a time in (starts_at, id) order, so no candidate is starved by the batch size.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(root, "tests", ".tmp-calendar-reminder-candidates-"));
after(() => rmSync(outDir, { recursive: true, force: true }));

const bundle = await buildSchema0088App(root, outDir);
const load = (name) => import(pathToFileURL(join(outDir, `${name}.mjs`)).href);
const app = await load("app");
const { SqliteDatabase } = await load("database");
const { applyMigrations } = await load("migrate");

const now = new Date("2026-11-16T12:00:00Z");

function expectReminders(result, recurring) {
	assert.deepEqual(result.reminded, ["one-off-due", "one-off-week-ahead"]);
	assert.equal(result.seriesReminded, recurring, "every series is looked at, past the first page");
	assert.deepEqual(result.changedBySecondRun, [], "a claimed occurrence is not reminded again");
}

test("SQLite: every due event is reminded once, across pages", async (t) => {
	const database = new SqliteDatabase(join(outDir, `${crypto.randomUUID()}.sqlite`));
	t.after(() => database.db.close());
	await applyMigrations(database, join(root, "drizzle/migrations"));
	expectReminders(await reminderCandidates(app, { DB: database }, { now }), 620);
});

test("SQLite: the cron reads calendar_events through the reminder index", async (t) => {
	const database = new SqliteDatabase(join(outDir, `${crypto.randomUUID()}.sqlite`));
	t.after(() => database.db.close());
	await applyMigrations(database, join(root, "drizzle/migrations"));
	const statements = [];
	const prepare = database.db.prepare.bind(database.db);
	database.db.prepare = (sql) => {
		if (/from "calendar_events"/i.test(sql) && /order by/i.test(sql)) statements.push(sql);
		return prepare(sql);
	};
	await app.runCalendarReminders({ DB: database }, now);
	database.db.prepare = prepare;
	assert.equal(statements.length, 2, "one query for one-off events, one for series");
	for (const sql of statements) {
		const params = Array.from(sql.matchAll(/\?/g), () => 0);
		const plan = prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params).map((row) => row.detail).join(" | ");
		assert.match(plan, /SEARCH calendar_events USING INDEX calendar_events_reminder_idx/, plan);
	}
});

test("PostgreSQL (PGlite): the same events are reminded", () => {
	const run = spawnSync(process.execPath, [join(root, "tests/fixtures/schema-0088-runner.mjs"), bundle, "reminderCandidates", JSON.stringify({ now, recurring: 520, pastOneOff: 40 })], {
		env: { ...process.env, MAILCLAW_DB_DIALECT: "postgres" },
		encoding: "utf8",
		timeout: 180_000,
	});
	assert.equal(run.status, 0, run.stderr);
	const { dialect, result } = JSON.parse(run.stdout);
	assert.equal(dialect, "postgres");
	expectReminders(result, 520);
});
