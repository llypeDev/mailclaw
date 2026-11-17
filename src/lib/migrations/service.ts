import { CompatDatabase } from "@/db/d1-compat";
import { isExternalDatabase } from "@/db/external";
import type { DatabaseDialect } from "@/db/dialect";
import type { SqlExecutor } from "@/db/drivers/types";
import sqliteBundle from "./bundle.json";
import mysqlBundle from "./bundle-mysql.json";
import postgresBundle from "./bundle-postgres.json";
import { optimizeSqliteDatabase } from "./optimize";
import {
	isAlreadyAppliedMysqlError,
	isProgressMarker,
	MYSQL_MIGRATION_LOCK_NAME,
	MYSQL_MIGRATION_LOCK_TIMEOUT_SECONDS,
	parseLedgerNames,
	POSTGRES_MIGRATION_LOCK_KEY,
	progressMarker,
} from "./service-utils";
import type { BundledMigration, MigrationNameRow, MigrationResult, MigrationStatus } from "./types";

const BUNDLES: Record<DatabaseDialect, BundledMigration[]> = {
	sqlite: sqliteBundle.migrations as BundledMigration[],
	postgres: postgresBundle.migrations as BundledMigration[],
	mysql: mysqlBundle.migrations as BundledMigration[],
};

/** D1 keeps the table name Wrangler uses, so `wrangler d1 migrations apply` and the in-app runner agree. */
const MIGRATION_TABLES: Record<DatabaseDialect, { table: string; create: string; exists: string }> = {
	sqlite: {
		table: "d1_migrations",
		create: "CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)",
		exists: "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'd1_migrations'",
	},
	postgres: {
		table: "mailclaw_migrations",
		create: "CREATE TABLE IF NOT EXISTS mailclaw_migrations (id BIGSERIAL PRIMARY KEY, name VARCHAR(255) NOT NULL UNIQUE, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)",
		exists: "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'mailclaw_migrations'",
	},
	mysql: {
		table: "mailclaw_migrations",
		create: "CREATE TABLE IF NOT EXISTS mailclaw_migrations (id BIGINT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(191) NOT NULL UNIQUE, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)",
		exists: "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = database() AND table_name = 'mailclaw_migrations'",
	},
};

/**
 * Taken as the first statement of every PostgreSQL migration transaction (and of the ledger creation),
 * so two runners never execute migration DDL at the same time. It is transaction-scoped on purpose: on
 * Workers the drivers open a connection per query, so a session-level `pg_advisory_lock` would be
 * released as soon as its own connection closed. A runner that waited on the lock then fails its
 * ledger insert (the name is unique), rolls back, and skips the migration the other runner applied.
 */
const POSTGRES_LOCK = `SELECT pg_advisory_xact_lock(${POSTGRES_MIGRATION_LOCK_KEY})`;

export function migrationDialect(db: D1Database): DatabaseDialect {
	return isExternalDatabase(db) ? db.config.dialect : "sqlite";
}

async function readLedgerNames(db: D1Database, dialect: DatabaseDialect): Promise<string[]> {
	const { table, exists } = MIGRATION_TABLES[dialect];
	const found = await db.prepare(exists).first<MigrationNameRow>();
	if (!found) return [];

	const result = await db.prepare(`SELECT name FROM ${table}`).all<MigrationNameRow>();
	return result.results.map((row) => row.name);
}

async function getAppliedMigrationNames(db: D1Database): Promise<string[]> {
	// Progress rows of an interrupted MySQL migration are bookkeeping, not applied migrations.
	return (await readLedgerNames(db, migrationDialect(db))).filter((name) => !isProgressMarker(name));
}

export async function getMigrationStatus(db: D1Database): Promise<MigrationStatus> {
	const migrations = BUNDLES[migrationDialect(db)];
	const applied = new Set(await getAppliedMigrationNames(db));
	const committed = new Set(migrations.map((migration) => migration.name));
	const pending = migrations.filter((migration) => !applied.has(migration.name)).map((migration) => migration.name);
	const unknown = [...applied].filter((name) => !committed.has(name)).sort();

	return { ready: pending.length === 0 && unknown.length === 0, pending, unknown };
}

export async function applyPendingMigrations(db: D1Database): Promise<MigrationResult> {
	const dialect = migrationDialect(db);
	const initial = await getMigrationStatus(db);
	if (initial.unknown.length > 0) {
		throw new Error("The database contains migrations that are not part of this Mailclaw release.");
	}
	if (initial.pending.length === 0) return { ...initial, applied: [] };

	const applied = dialect === "mysql"
		? await withMysqlMigrationLock(db, (locked) => applyMysqlMigrations(locked))
		: await applyTransactionalMigrations(db, dialect, initial.pending);

	// New tables and indexes start without planner statistics; SQLite only (D1, libSQL, better-sqlite3).
	if (applied.length > 0) await optimizeSqliteDatabase(db);

	return { ...(await getMigrationStatus(db)), applied };
}

/** SQLite (D1 batches are atomic) and PostgreSQL: each migration is one transaction that records itself first. */
async function applyTransactionalMigrations(db: D1Database, dialect: "sqlite" | "postgres", pending: string[]): Promise<string[]> {
	const migrations = BUNDLES[dialect];
	const { table, create } = MIGRATION_TABLES[dialect];
	const lock = dialect === "postgres" ? [db.prepare(POSTGRES_LOCK)] : [];
	await db.batch([...lock, db.prepare(create)]);
	const applied: string[] = [];

	for (const name of pending) {
		const migration = migrations.find((candidate) => candidate.name === name);
		if (!migration) continue;

		try {
			await db.batch([
				...lock,
				db.prepare(`INSERT INTO ${table} (name) VALUES (?)`).bind(name),
				...migration.statements.map((statement) => db.prepare(statement)),
			]);
			applied.push(name);
		} catch (error) {
			// Another runner applied it first: its ledger row made our insert fail and roll back.
			const completed = await db.prepare(`SELECT name FROM ${table} WHERE name = ?`).bind(name).first<MigrationNameRow>();
			if (completed) continue;
			throw new Error(`Migration ${name} failed: ${error instanceof Error ? error.message : "Database error"}`);
		}
	}
	return applied;
}

/**
 * Holds the MySQL user-level lock `GET_LOCK` for the whole run on one connection, so a second runner
 * (another Worker request, a second container) waits instead of interleaving DDL. The lock belongs to
 * the session, so the run must stay on the connection that took it: it goes through the driver's
 * transaction hook, which is the one place an executor keeps a connection, and immediately commits
 * that transaction so every statement after it autocommits as MySQL DDL would anyway.
 */
async function withMysqlMigrationLock<T>(db: D1Database, run: (locked: D1Database) => Promise<T>): Promise<T> {
	const executor = isExternalDatabase(db) ? db.sqlExecutor : null;
	if (!executor?.transaction) {
		console.warn("MySQL migrations are running without a lock: this driver cannot hold a connection.");
		return run(db);
	}
	return executor.transaction(async (connection: SqlExecutor) => {
		let acquired: number | null = null;
		try {
			const result = await connection.query("SELECT GET_LOCK(?, ?) AS acquired", [MYSQL_MIGRATION_LOCK_NAME, MYSQL_MIGRATION_LOCK_TIMEOUT_SECONDS], "object");
			acquired = Number((result.rows[0] as { acquired?: unknown } | undefined)?.acquired ?? 0);
		} catch (error) {
			// Some MySQL-compatible services (Vitess-based ones among them) may refuse user-level locks.
			console.warn("MySQL migrations are running without a lock: GET_LOCK failed.", error);
		}
		// 0 is a timeout and NULL an error inside MySQL; either way another run may be active.
		if (acquired !== null && acquired !== 1) {
			throw new Error(`Another migration run is still in progress (waited ${MYSQL_MIGRATION_LOCK_TIMEOUT_SECONDS} s). Try again when it finishes.`);
		}
		const locked = acquired === 1;
		try {
			await connection.query("COMMIT", [], "object");
			return await run(new CompatDatabase("mysql", connection) as unknown as D1Database);
		} finally {
			if (locked) await connection.query("SELECT RELEASE_LOCK(?)", [MYSQL_MIGRATION_LOCK_NAME], "object").catch(() => undefined);
		}
	});
}

/**
 * MySQL commits DDL implicitly, so a migration cannot be atomic. Progress is recorded in the ledger
 * after every statement (see service-utils.ts); a failed or interrupted run therefore resumes at the
 * first statement that did not commit. The ledger is re-read here, under the lock, because another
 * runner may have finished while this one waited.
 */
async function applyMysqlMigrations(db: D1Database): Promise<string[]> {
	const { table, create } = MIGRATION_TABLES.mysql;
	await db.prepare(create).run();
	const ledger = parseLedgerNames(await readLedgerNames(db, "mysql"));
	const applied: string[] = [];

	for (const migration of BUNDLES.mysql) {
		const { name, statements } = migration;
		if (ledger.applied.has(name)) continue;

		const progress = ledger.partial.get(name);
		const resumeAt = Math.min(progress?.completed ?? 0, statements.length);
		let marker = progress?.marker ?? progressMarker(name, 0);
		try {
			if (!progress) await db.prepare(`INSERT INTO ${table} (name) VALUES (?)`).bind(marker).run();
			for (let index = resumeAt; index < statements.length; index += 1) {
				try {
					await db.prepare(statements[index]).run();
				} catch (error) {
					// Only on a resumed run, and only for its first statement: that statement may have
					// committed just before the progress write that would have recorded it was lost.
					if (!(progress && index === resumeAt && isAlreadyAppliedMysqlError(error))) throw error;
				}
				const next = progressMarker(name, index + 1);
				await db.prepare(`UPDATE ${table} SET name = ? WHERE name = ?`).bind(next, marker).run();
				marker = next;
			}
			// Renaming the progress row is what records the migration as applied.
			await db.prepare(`UPDATE ${table} SET name = ? WHERE name = ?`).bind(name, marker).run();
			applied.push(name);
		} catch (error) {
			throw new Error(`Migration ${name} failed: ${error instanceof Error ? error.message : "Database error"}`);
		}
	}
	return applied;
}
