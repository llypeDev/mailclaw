// Child process of tests/message-counters.test.mjs. The schema picks its dialect when first imported,
// so the PostgreSQL run needs its own process started with MAILCLAW_DB_DIALECT=postgres. Applies the
// PostgreSQL migration bundle to PGlite (so migration 0013 and its trigger run for real), then the
// shared scenario. Prints JSON results.
import { pathToFileURL } from "node:url";
import { runCounterScenario, seedCounterAccounts } from "./message-counters-scenario.mjs";

const app = await import(pathToFileURL(process.argv[2]).href);
const config = app.getDatabaseConfig({ DATABASE_URL: "pglite://memory" });
const database = app.openExternalDatabase(config, true);
const applied = await app.applyPendingMigrations(database);
if (!applied.ready) throw new Error(`migrations did not apply: ${JSON.stringify(applied)}`);
const db = app.createDb(database);
await seedCounterAccounts(db, app.schema);
const result = await runCounterScenario(db, app.schema, app, { seed: Number(process.argv[3] ?? 7), steps: Number(process.argv[4] ?? 250), every: 25 });
process.stdout.write(JSON.stringify({ dialect: app.schemaDialect(), ...result, mismatches: result.mismatches.slice(0, 3) }));
process.exit(0);
