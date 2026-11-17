import { isExternalDatabase } from "@/db/external";

/**
 * Runs `PRAGMA optimize` on SQLite databases (D1, libSQL, better-sqlite3) so the query planner has
 * statistics: without `sqlite_stat1` it can prefer a wide `mailbox_id` index over a selective one and
 * scan a whole mailbox. The pragma analyzes only tables that need it (indexes without statistics, or
 * row counts that changed tenfold) under a temporary analysis limit, so it is cheap to repeat; a bare
 * `ANALYZE` would read every index in full. D1 documents `PRAGMA optimize` as supported and
 * recommends it after schema changes. PostgreSQL and MySQL keep their own statistics.
 *
 * Called after migrations are applied and from the daily 02:00 cron. A failure is only logged.
 */
export async function optimizeSqliteDatabase(db: D1Database | undefined | null): Promise<boolean> {
	if (!db) return false;
	if (isExternalDatabase(db) && db.config.dialect !== "sqlite") return false;
	try {
		await db.prepare("PRAGMA optimize").run();
		return true;
	} catch (error) {
		console.error("PRAGMA optimize failed", error);
		return false;
	}
}

/** Daily maintenance entry point for worker.ts and the Node scheduler. */
export async function runDatabaseOptimize(env: CloudflareEnv): Promise<boolean> {
	return optimizeSqliteDatabase(env.DB);
}
