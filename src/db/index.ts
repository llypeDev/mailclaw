import { drizzle } from "drizzle-orm/d1";
import { schema } from "@/db/schema";
import { isExternalDatabase } from "./external";

export type AppDatabase = ReturnType<typeof createD1Db>;

function createD1Db(d1: D1Database) {
	return drizzle(d1, { schema });
}

/**
 * One drizzle instance per D1 binding object. Building one walks the whole schema, and `getDb` runs
 * hundreds of times along request paths. The instance holds no state beyond its binding, and a D1
 * session (`withSession`) is a distinct object with its own instance.
 *
 * External databases are not cached: their instance keeps an open batch's connection on itself
 * (`ctx.tx` in compat.ts), and one `ExternalDatabase` serves every request of the process, so a shared
 * instance would let a concurrent request run inside another request's transaction.
 */
const d1Instances = new WeakMap<object, AppDatabase>();

/**
 * The drizzle instance for `env.DB`. That is the D1 binding by default; when `DATABASE_URL` selects another
 * database `env.DB` is an external database (see `withDatabase`) that builds its own dialect's instance.
 * Everything is typed as SQLite, the dialect the app is written against (see compat.ts).
 */
export function createDb(d1: D1Database): AppDatabase {
	if (isExternalDatabase(d1)) return d1.createDrizzle(schema as never) as AppDatabase;
	let db = d1Instances.get(d1);
	if (!db) {
		db = createD1Db(d1);
		d1Instances.set(d1, db);
	}
	return db;
}

export function getDb(env: Pick<CloudflareEnv, "DB">) {
	if (!env.DB) {
		throw new Error("No database binding configured");
	}
	return createDb(env.DB);
}

export { schema };
