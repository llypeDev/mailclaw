// Child process of the migration 0088 tests. The schema picks its dialect when first imported, so the
// PostgreSQL run needs its own process started with MAILCLAW_DB_DIALECT=postgres. Prints JSON results.
import { pathToFileURL } from "node:url";
import * as scenarios from "./schema-0088-scenarios.mjs";

const [, , bundle, scenario, options] = process.argv;
const app = await import(pathToFileURL(bundle).href);
const config = app.getDatabaseConfig({ DATABASE_URL: "pglite://memory" });
const database = app.openExternalDatabase(config, true);
const applied = await app.applyPendingMigrations(database);
if (!applied.ready) throw new Error(`migrations did not apply: ${JSON.stringify(applied)}`);
const parsed = options ? JSON.parse(options) : {};
if (parsed.now) parsed.now = new Date(parsed.now);
const result = await scenarios[scenario](app, { DB: database }, parsed);
process.stdout.write(JSON.stringify({ dialect: app.schemaDialect(), result }));
process.exit(0);
