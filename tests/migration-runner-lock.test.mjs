import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

// The shared migration runner (src/lib/migrations/service.ts) against scripted executors: the MySQL
// GET_LOCK around a run and its resumable progress rows, the PostgreSQL transaction-scoped advisory
// lock, and `PRAGMA optimize` after SQLite migrations. No real database is involved.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(root, "tests", ".tmp-migration-runner-"));
after(() => rmSync(outDir, { recursive: true, force: true }));

await build({
	entryPoints: {
		service: join(root, "src/lib/migrations/service.ts"),
		utils: join(root, "src/lib/migrations/service-utils.ts"),
		compat: join(root, "src/db/d1-compat.ts"),
	},
	outdir: outDir,
	outExtension: { ".js": ".mjs" },
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node22",
	tsconfig: join(root, "tsconfig.json"),
	packages: "external",
	logLevel: "silent",
});

const load = (name) => import(pathToFileURL(join(outDir, `${name}.mjs`)).href);
const { applyPendingMigrations, getMigrationStatus } = await load("service");
const { parseLedgerNames, progressMarker, isAlreadyAppliedMysqlError, POSTGRES_MIGRATION_LOCK_KEY } = await load("utils");
const { CompatDatabase } = await load("compat");
const mysqlBundle = (await import(pathToFileURL(join(root, "src/lib/migrations/bundle-mysql.json")).href, { with: { type: "json" } })).default;
const postgresBundle = (await import(pathToFileURL(join(root, "src/lib/migrations/bundle-postgres.json")).href, { with: { type: "json" } })).default;

const LEDGER = "mailclaw_migrations";

/**
 * A scripted executor: keeps the ledger in memory, answers the runner's own queries and records
 * every migration statement. `failAt(sql, count)` makes a statement fail (once it has been seen).
 */
function scriptedExecutor(dialect, state) {
	const executor = {
		dialect,
		async query(sql, params) {
			state.log.push(sql);
			if (/GET_LOCK/.test(sql)) {
				state.locks.push(params[0]);
				return { rows: [{ acquired: state.lockResult ?? 1 }], affectedRows: 0 };
			}
			if (/RELEASE_LOCK/.test(sql)) {
				state.released.push(params[0]);
				return { rows: [{ released: 1 }], affectedRows: 0 };
			}
			if (/information_schema\.tables/.test(sql)) return { rows: state.ledgerExists ? [{ name: LEDGER }] : [], affectedRows: 0 };
			if (/^CREATE TABLE IF NOT EXISTS mailclaw_migrations/.test(sql)) {
				state.ledgerExists = true;
				return { rows: [], affectedRows: 0 };
			}
			if (sql === `SELECT name FROM ${LEDGER}`) return { rows: state.ledger.map((name) => ({ name })), affectedRows: state.ledger.length };
			if (sql.startsWith(`SELECT name FROM ${LEDGER} WHERE name =`)) {
				return { rows: state.ledger.includes(params[0]) ? [{ name: params[0] }] : [], affectedRows: 0 };
			}
			if (sql.startsWith(`INSERT INTO ${LEDGER}`)) {
				if (state.ledger.includes(params[0])) throw Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" });
				state.ledger.push(params[0]);
				return { rows: [], affectedRows: 1 };
			}
			if (sql.startsWith(`UPDATE ${LEDGER} SET name`)) {
				const index = state.ledger.indexOf(params[1]);
				if (index === -1) return { rows: [], affectedRows: 0 };
				state.ledger[index] = params[0];
				return { rows: [], affectedRows: 1 };
			}
			if (/^SELECT pg_advisory_xact_lock|^COMMIT$/.test(sql)) return { rows: [], affectedRows: 0 };
			// A migration statement.
			const failure = state.failures.get(sql);
			if (failure && failure.remaining > 0) {
				failure.remaining -= 1;
				state.log.push("(failed)");
				throw failure.error;
			}
			state.executed.push(sql);
			return { rows: [], affectedRows: 0 };
		},
	};
	if (state.transactions) {
		executor.transaction = async (fn) => {
			state.transactionCount += 1;
			const snapshot = [...state.ledger];
			const executed = state.executed.length;
			try {
				return await fn({ dialect, query: executor.query });
			} catch (error) {
				// PostgreSQL rolls the whole migration back; MySQL DDL has already committed (not modelled here).
				if (dialect === "postgres") {
					// Rows another runner committed meanwhile survive our rollback.
					const others = state.committedByOthers.filter((name) => !snapshot.includes(name));
					state.ledger.splice(0, state.ledger.length, ...snapshot, ...others);
					state.executed.length = executed;
				}
				throw error;
			}
		};
	}
	return executor;
}

function externalDatabase(dialect, overrides = {}) {
	const state = {
		log: [],
		executed: [],
		ledger: [],
		ledgerExists: false,
		locks: [],
		released: [],
		failures: new Map(),
		committedByOthers: [],
		transactions: true,
		transactionCount: 0,
		...overrides,
	};
	const executor = scriptedExecutor(dialect, state);
	const db = new CompatDatabase(dialect, executor);
	Object.defineProperties(db, {
		config: { value: { dialect, driver: dialect === "mysql" ? "mysql2" : "node-postgres", url: "x" } },
		sqlExecutor: { value: executor },
		createDrizzle: { value: () => ({}) },
	});
	state.failAt = (sql, error, times = 1) => state.failures.set(sql, { remaining: times, error });
	return { db, state };
}

const silence = (t) => {
	t.mock.method(console, "warn", () => undefined);
	t.mock.method(console, "error", () => undefined);
};

test("parseLedgerNames separates applied migrations from progress rows", () => {
	const { applied, partial } = parseLedgerNames(["0000_baseline.sql", progressMarker("0001_x.sql", 7), "0002#partial:nope"]);
	assert.deepEqual([...applied], ["0000_baseline.sql"]);
	assert.deepEqual([...partial.entries()], [["0001_x.sql", { marker: "0001_x.sql#partial:7", completed: 7 }]]);
});

test("isAlreadyAppliedMysqlError recognises mysql2 codes, errnos and messages", () => {
	assert.equal(isAlreadyAppliedMysqlError(Object.assign(new Error("x"), { code: "ER_TABLE_EXISTS_ERROR" })), true);
	assert.equal(isAlreadyAppliedMysqlError(Object.assign(new Error("x"), { errno: 1061 })), true);
	assert.equal(isAlreadyAppliedMysqlError(new Error("Table 'users' already exists")), true);
	assert.equal(isAlreadyAppliedMysqlError(new Error("failed", { cause: new Error("Duplicate column name 'a'") })), true);
	assert.equal(isAlreadyAppliedMysqlError(new Error("You have an error in your SQL syntax")), false);
	assert.equal(isAlreadyAppliedMysqlError(Object.assign(new Error("x"), { code: "ER_LOCK_DEADLOCK" })), false);
});

test("MySQL: the run holds GET_LOCK on one connection and records every migration", async () => {
	const { db, state } = externalDatabase("mysql");
	const result = await applyPendingMigrations(db);

	assert.equal(state.transactionCount, 1, "one connection for the whole run");
	assert.deepEqual(state.locks, ["mailclaw_migrations"]);
	assert.deepEqual(state.released, ["mailclaw_migrations"]);
	assert.ok(state.log.indexOf("COMMIT") > state.log.findIndex((sql) => /GET_LOCK/.test(sql)), "commits right after taking the lock");
	assert.deepEqual(result.applied, mysqlBundle.migrations.map((migration) => migration.name));
	assert.deepEqual(state.ledger, mysqlBundle.migrations.map((migration) => migration.name));
	assert.equal(result.ready, true);
	assert.equal(state.executed.length, mysqlBundle.migrations.reduce((sum, migration) => sum + migration.statements.length, 0));
	assert.ok(!state.log.some((sql) => /PRAGMA/.test(sql)), "no PRAGMA on MySQL");
});

test("MySQL: a second runner that cannot get the lock fails without touching the schema", async () => {
	const { db, state } = externalDatabase("mysql", { lockResult: 0 });
	await assert.rejects(applyPendingMigrations(db), /Another migration run is still in progress/);
	assert.deepEqual(state.executed, []);
	assert.deepEqual(state.ledger, []);
});

test("MySQL: a failed run resumes at the first statement that did not commit", async (t) => {
	silence(t);
	const { db, state } = externalDatabase("mysql");
	const target = mysqlBundle.migrations[1];
	const failing = target.statements[3];
	state.failAt(failing, new Error("Lost connection to MySQL server during query"));

	await assert.rejects(applyPendingMigrations(db), new RegExp(`Migration ${target.name} failed`));
	assert.ok(state.ledger.includes(progressMarker(target.name, 3)), "progress row records 3 committed statements");
	const status = await getMigrationStatus(db);
	assert.ok(status.pending.includes(target.name));
	assert.deepEqual(status.unknown, [], "progress rows are not reported as unknown migrations");

	const before = state.executed.length;
	const resumed = await applyPendingMigrations(db);
	const rerun = state.executed.slice(before);
	assert.equal(rerun[0], failing, "resumes at the failed statement");
	assert.ok(!rerun.includes(target.statements[0]), "does not repeat committed statements");
	assert.equal(resumed.ready, true);
	assert.ok(state.ledger.includes(target.name));
	assert.ok(!state.ledger.some((name) => name.includes("#partial:")));
});

test("MySQL: on resume, the one statement whose progress write was lost may already exist", async (t) => {
	silence(t);
	const target = mysqlBundle.migrations[1];
	// Statement 2 committed, but the run died before recording it: the ledger still says 2.
	const { db, state } = externalDatabase("mysql", {
		ledgerExists: true,
		ledger: [mysqlBundle.migrations[0].name, progressMarker(target.name, 2)],
	});
	state.failAt(target.statements[2], Object.assign(new Error("Trigger already exists"), { code: "ER_TRG_ALREADY_EXISTS" }));

	const result = await applyPendingMigrations(db);
	assert.equal(result.ready, true);
	assert.ok(state.ledger.includes(target.name));

	// The same error on any later statement is a real failure.
	const second = externalDatabase("mysql", {
		ledgerExists: true,
		ledger: [mysqlBundle.migrations[0].name, progressMarker(target.name, 2)],
	});
	second.state.failAt(target.statements[3], Object.assign(new Error("Table exists"), { code: "ER_TABLE_EXISTS_ERROR" }));
	await assert.rejects(applyPendingMigrations(second.db), /failed/);
});

test("PostgreSQL: every migration transaction takes the advisory lock before its ledger insert", async () => {
	const { db, state } = externalDatabase("postgres");
	const result = await applyPendingMigrations(db);
	assert.equal(result.ready, true);
	const lock = `SELECT pg_advisory_xact_lock(${POSTGRES_MIGRATION_LOCK_KEY})`;
	const locks = state.log.filter((sql) => sql === lock).length;
	assert.equal(locks, postgresBundle.migrations.length + 1, "one per migration plus the ledger creation");
	for (let i = 0; i < state.log.length; i += 1) {
		if (state.log[i].startsWith(`INSERT INTO ${LEDGER}`)) assert.equal(state.log[i - 1], lock);
	}
	assert.ok(!state.log.some((sql) => /PRAGMA/.test(sql)), "no PRAGMA on PostgreSQL");
});

test("PostgreSQL: a migration another runner applied while this one waited is skipped", async () => {
	const { db, state } = externalDatabase("postgres");
	const name = postgresBundle.migrations[2].name;
	// The other runner commits its ledger row first; ours then fails the unique insert and rolls back.
	const original = db.sqlExecutor.query;
	let raced = false;
	db.sqlExecutor.query = async (sql, params, mode) => {
		if (!raced && sql.startsWith(`INSERT INTO ${LEDGER}`) && params[0] === name) {
			raced = true;
			state.ledger.push(name);
			state.committedByOthers.push(name);
		}
		return original(sql, params, mode);
	};
	const result = await applyPendingMigrations(db);
	assert.ok(!result.applied.includes(name));
	assert.equal(result.ready, true);
});

test("SQLite: PRAGMA optimize runs after migrations are applied, and its failure is only logged", async (t) => {
	silence(t);
	const statements = [];
	const ledger = [];
	const fakeD1 = {
		prepare(sql) {
			const statement = {
				sql,
				params: [],
				bind(...params) {
					return { ...statement, params };
				},
				async first() {
					statements.push(sql);
					if (/sqlite_master/.test(sql)) return ledger.length ? { name: "d1_migrations" } : null;
					return null;
				},
				async all() {
					statements.push(sql);
					return { results: ledger.map((name) => ({ name })) };
				},
				async run() {
					statements.push(sql);
					if (sql === "PRAGMA optimize") throw new Error("not authorized");
					return { success: true };
				},
			};
			return statement;
		},
		async batch(list) {
			for (const statement of list) {
				statements.push(statement.sql);
				if (statement.sql.startsWith("INSERT INTO d1_migrations")) ledger.push(statement.params[0]);
			}
			return [];
		},
	};
	const result = await applyPendingMigrations(fakeD1);
	assert.ok(result.applied.length > 0);
	assert.equal(statements.filter((sql) => sql === "PRAGMA optimize").length, 1);

	// Nothing pending: no optimize.
	statements.length = 0;
	await applyPendingMigrations(fakeD1);
	assert.equal(statements.filter((sql) => sql === "PRAGMA optimize").length, 0);
});
