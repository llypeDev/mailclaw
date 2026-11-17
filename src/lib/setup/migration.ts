import { listTableNames } from "@/db/introspect";
import { applyPendingMigrations } from "@/lib/migrations/service";

/** Raised when setup finds tables it did not create; the caller answers 409 instead of migrating. */
export class DatabaseNotEmptyError extends Error {
	constructor(tables: string[]) {
		const shown = tables.slice(0, 5).join(", ") + (tables.length > 5 ? ", …" : "");
		super(`The database already contains tables that Mailclaw did not create (${shown}). Setup only initializes an empty database.`);
		this.name = "DatabaseNotEmptyError";
	}
}

const LEDGER_TABLES = new Set(["d1_migrations", "mailclaw_migrations"]);

/** SQLite bookkeeping and D1's own `_cf_*` tables exist in every database, so they never count. */
function isSystemTable(name: string): boolean {
	return name.startsWith("sqlite_") || name.startsWith("_cf_");
}

export async function migrateCleanDatabase(db: D1Database): Promise<boolean> {
	const tables = [...(await listTableNames(db))].filter((name) => !isSystemTable(name));
	// A migration ledger means a Mailclaw runner (this one, Wrangler or the Node server) owns the
	// database, so pending migrations are safe to apply. Without one, any table is someone else's.
	if (!tables.some((name) => LEDGER_TABLES.has(name)) && tables.length > 0) {
		throw new DatabaseNotEmptyError(tables.sort());
	}
	const result = await applyPendingMigrations(db);
	return result.applied.length > 0;
}
