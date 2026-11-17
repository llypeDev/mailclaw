// Builds the code under test for the migration 0088 tests: one bundle used by the SQLite run in the test
// process and by the PostgreSQL run in schema-0088-runner.mjs.
import { join } from "node:path";
import { build } from "esbuild";

export async function buildSchema0088App(root, outDir) {
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
				export { createLoginChallenge, getLoginChallengeUserId, peekLoginChallengeUserId, consumeLoginChallenge, MAX_LOGIN_CHALLENGE_ATTEMPTS } from "./src/lib/auth/login-challenge";
				export { runCalendarReminders } from "./src/lib/calendar/reminders";
				export { schemaDialect } from "./src/db/dialect";
				export { createDb } from "./src/db";
				export * as tables from "./src/db/schema";
				export { getDatabaseConfig } from "./src/db/with-database";
				export { openExternalDatabase } from "./src/db/external";
				export { applyPendingMigrations } from "./src/lib/migrations/service";
			`,
			resolveDir: root,
			loader: "ts",
		},
		outfile: join(outDir, "app.mjs"),
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
	return join(outDir, "app.mjs");
}
