import assert from "node:assert/strict";
import test, { after } from "node:test";
import { loadAppWithSqlite } from "./helpers/app-sqlite.mjs";

// src/lib/setup and POST /api/setup/prepare against real SQLite files: the requirement checks on
// both runtimes, the admin check that closes setup, and the migration of a clean database through
// the shared runner (bundle.json, as the Worker applies it), including what happens when the
// database is not clean. Only getEnv() is stubbed.
const state = { env: null };
globalThis.__setupTest = state;
after(() => delete globalThis.__setupTest);

const app = await loadAppWithSqlite({
	name: "setup",
	exports: [
		`export { getSetupRequirementChecks } from "./src/lib/setup/configuration.ts";`,
		`export { migrateCleanDatabase } from "./src/lib/setup/migration.ts";`,
		`export { hasAdminAccount } from "./src/lib/auth/setup.ts";`,
		`export { getMigrationStatus } from "./src/lib/migrations/service.ts";`,
		`export { POST as prepare } from "./src/app/api/setup/prepare/route.ts";`,
	],
	mocks: {
		"@/lib/cloudflare": "export function getEnv() { return globalThis.__setupTest.env; }",
	},
});
after(app.dispose);
const lib = app.lib;

// DATABASE_URL in the test process would change which database the checks describe.
const savedDatabaseUrl = process.env.DATABASE_URL;
delete process.env.DATABASE_URL;
after(() => { if (savedDatabaseUrl !== undefined) process.env.DATABASE_URL = savedDatabaseUrl; });

const tables = (database) => database.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().map((row) => row.name);
const ledger = (database) => database.db.prepare("SELECT name FROM d1_migrations ORDER BY id").all().map((row) => row.name);
const summary = (checks) => checks.map((check) => [check.key, check.configured]);

test("on Workers, setup needs Cloudflare credentials and a database binding", () => {
	const db = {};
	assert.deepEqual(summary(lib.getSetupRequirementChecks({ CF_TOKEN: "token", DB: db })), [
		["Cloudflare API credentials", true],
		["D1 database", true],
	]);
	assert.equal(lib.getSetupRequirementChecks({ CF_API_KEY: "key", CF_EMAIL: "me@example.com", DB: db })[0].configured, true);
	for (const credentials of [{}, { CF_TOKEN: "   " }, { CF_API_KEY: "key" }, { CF_EMAIL: "me@example.com" }, { CF_API_KEY: " ", CF_EMAIL: "me@example.com" }]) {
		assert.equal(lib.getSetupRequirementChecks({ ...credentials, DB: db })[0].configured, false, JSON.stringify(credentials));
	}
	assert.deepEqual(summary(lib.getSetupRequirementChecks({ CF_TOKEN: "token" })), [
		["Cloudflare API credentials", true],
		["D1 database", false],
	]);
	const external = lib.getSetupRequirementChecks({ CF_TOKEN: "token", DB: db, DATABASE_URL: "postgres://mailclaw@db.example.com/mail" });
	assert.equal(external[1].key, "Database");
	assert.match(external[1].message, /DATABASE_URL/);
});

test("self-hosted, Cloudflare credentials are optional and outbound mail is reported", () => {
	const node = { MAILCLAW_RUNTIME: "node", DB: {}, EMAIL: { configured: true } };
	assert.deepEqual(summary(lib.getSetupRequirementChecks(node)), [
		["Database", true],
		["Outbound mail", true],
		["Cloudflare API credentials (optional)", true],
	]);
	const [database, , cloudflare] = lib.getSetupRequirementChecks(node);
	assert.match(database.message, /DATA_DIR/);
	assert.match(cloudflare.message, /by hand/);
	assert.match(lib.getSetupRequirementChecks({ ...node, CF_TOKEN: "token" })[2].message, /automatically/);
	assert.equal(lib.getSetupRequirementChecks({ ...node, EMAIL: { configured: false } })[1].configured, false);
	assert.equal(lib.getSetupRequirementChecks({ ...node, EMAIL: undefined })[1].configured, false);
	assert.equal(lib.getSetupRequirementChecks({ ...node, DB: undefined })[0].configured, false);
	assert.match(lib.getSetupRequirementChecks({ ...node, DATABASE_URL: "mysql://db.example.com/mail" })[0].message, /DATABASE_URL/);
});

test("setup counts as done only once an admin account exists", async (t) => {
	assert.equal(await lib.hasAdminAccount({}), false, "no database binding");
	const empty = app.openEmptyDatabase(t);
	assert.equal(await lib.hasAdminAccount({ DB: empty }), false, "no users table yet");

	const database = await app.openDatabase(t);
	assert.equal(await lib.hasAdminAccount({ DB: database }), false);
	database.db.prepare("INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES ('u', 'u@example.com', 'U', 'x', 'user', 0)").run();
	assert.equal(await lib.hasAdminAccount({ DB: database }), false);
	database.db.prepare("INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES ('a', 'a@example.com', 'A', 'x', 'admin', 0)").run();
	assert.equal(await lib.hasAdminAccount({ DB: database }), true);
});

test("a clean database is migrated once; a second run applies nothing", async (t) => {
	const database = app.openEmptyDatabase(t);
	assert.equal(await lib.migrateCleanDatabase(database), true);
	const status = await lib.getMigrationStatus(database);
	assert.deepEqual(status, { ready: true, pending: [], unknown: [] });
	assert.ok(ledger(database).length > 50);
	assert.ok(tables(database).includes("users"));
	assert.equal(await lib.migrateCleanDatabase(database), false);
});

test("a database from a newer release is refused before anything is applied", async (t) => {
	const database = app.openEmptyDatabase(t);
	database.db.exec("CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)");
	database.db.prepare("INSERT INTO d1_migrations (name) VALUES ('9999_from_the_future.sql')").run();
	await assert.rejects(lib.migrateCleanDatabase(database), /not part of this Mailclaw release/);
	assert.deepEqual(tables(database), ["d1_migrations"]);
});

test("a database with tables Mailclaw did not create is refused before anything is applied", async (t) => {
	const database = app.openEmptyDatabase(t);
	database.db.exec("CREATE TABLE invoices (id TEXT PRIMARY KEY); CREATE TABLE _cf_KV (key TEXT PRIMARY KEY, value BLOB)");
	await assert.rejects(lib.migrateCleanDatabase(database), (error) => {
		assert.equal(error.name, "DatabaseNotEmptyError");
		assert.match(error.message, /\(invoices\)/, "D1's own _cf_ tables are not listed");
		return true;
	});
	assert.deepEqual(tables(database).sort(), ["_cf_KV", "invoices"]);

	// D1's internal tables alone do not make a database "not empty".
	const d1 = app.openEmptyDatabase(t);
	d1.db.exec("CREATE TABLE _cf_KV (key TEXT PRIMARY KEY, value BLOB)");
	assert.equal(await lib.migrateCleanDatabase(d1), true);
});

test("a migration that collides with an existing table fails and records nothing", async (t) => {
	const database = app.openEmptyDatabase(t);
	// A ledger marks the database as Mailclaw's, so the runner gets as far as the colliding migration.
	database.db.exec("CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)");
	database.db.exec("CREATE TABLE users (id TEXT PRIMARY KEY, legacy TEXT)");
	await assert.rejects(lib.migrateCleanDatabase(database), /^Error: Migration \S+ failed: /);
	assert.deepEqual(ledger(database), [], "the failing migration rolled back with its ledger row");
	assert.deepEqual(database.db.prepare("PRAGMA table_info(users)").all().map((column) => column.name), ["id", "legacy"]);
});

test("POST /api/setup/prepare is closed after setup, waits for requirements, and migrates once", async (t) => {
	const database = app.openEmptyDatabase(t);

	state.env = { DB: database };
	let response = await lib.prepare();
	assert.equal(response.status, 503);
	const missing = await response.json();
	assert.equal(missing.migrated, false);
	assert.deepEqual(summary(missing.checks), [["Cloudflare API credentials", false], ["D1 database", true]]);
	assert.deepEqual(tables(database), [], "nothing is written while a requirement is missing");

	state.env = { DB: database, CF_TOKEN: "token" };
	response = await lib.prepare();
	assert.equal(response.status, 200);
	assert.equal((await response.json()).migrated, true);
	response = await lib.prepare();
	assert.equal(response.status, 200);
	assert.equal((await response.json()).migrated, false);

	database.db.prepare("INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES ('a', 'a@example.com', 'A', 'x', 'admin', 0)").run();
	response = await lib.prepare();
	assert.equal(response.status, 403);
	assert.deepEqual(await response.json(), { error: "Initial setup is already complete" });
});

test("POST /api/setup/prepare answers JSON errors: 409 for a foreign database, 500 for a failed migration", async (t) => {
	const database = app.openEmptyDatabase(t);
	database.db.exec("CREATE TABLE users (id TEXT PRIMARY KEY, legacy TEXT)");
	state.env = { DB: database, CF_TOKEN: "token" };
	// The legacy users table has no role column, so the admin check itself fails; the route still
	// answers with its own JSON instead of letting the framework turn the throw into a bare 500.
	let response = await lib.prepare();
	assert.equal(response.status, 500);
	assert.match((await response.json()).error, /role/);

	const other = app.openEmptyDatabase(t);
	other.db.exec("CREATE TABLE domains (id TEXT PRIMARY KEY)");
	state.env = { DB: other, CF_TOKEN: "token" };
	response = await lib.prepare();
	assert.equal(response.status, 409);
	let body = await response.json();
	assert.equal(body.migrated, false);
	assert.match(body.error, /did not create \(domains\)/);
	assert.deepEqual(tables(other), ["domains"], "nothing was applied");

	const owned = app.openEmptyDatabase(t);
	owned.db.exec("CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)");
	owned.db.exec("CREATE TABLE domains (id TEXT PRIMARY KEY)");
	state.env = { DB: owned, CF_TOKEN: "token" };
	response = await lib.prepare();
	assert.equal(response.status, 500);
	body = await response.json();
	assert.equal(body.migrated, false);
	assert.match(body.error, /^Migration \S+ failed: /);
});
