// Child process of tests/search.test.mjs. The schema picks its dialect when first imported, so the
// PostgreSQL run needs its own process started with MAILCLAW_DB_DIALECT=postgres. Prints JSON results.
import { pathToFileURL } from "node:url";
import { and, asc, eq } from "drizzle-orm";
import { runSearchQueries, seedSearchMailbox } from "./search-scenario.mjs";

const app = await import(pathToFileURL(process.argv[2]).href);
const config = app.getDatabaseConfig({ DATABASE_URL: "pglite://memory" });
const database = app.openExternalDatabase(config, true);
const applied = await app.applyPendingMigrations(database);
if (!applied.ready) throw new Error(`migrations did not apply: ${JSON.stringify(applied)}`);
const db = app.createDb(database);
await seedSearchMailbox(db, app.schema);
const results = await runSearchQueries(db, app.schema, app.buildSearchConditions, { and, asc, eq });
process.stdout.write(JSON.stringify({ dialect: app.schemaDialect(), results }));
process.exit(0);
