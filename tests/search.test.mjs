import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { and, asc, eq } from "drizzle-orm";
import { build } from "esbuild";
import { runSearchQueries, SEARCH_QUERIES, seedSearchMailbox } from "./fixtures/search-scenario.mjs";

// src/lib/search: the Gmail-style grammar (query-utils.ts) as pure functions, then
// buildSearchConditions (conditions.ts) run for real: against a migrated SQLite database
// through the FTS5 index, and against PGlite for the LIKE fallback of PostgreSQL/MySQL.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(root, "tests", ".tmp-search-"));
after(() => rmSync(outDir, { recursive: true, force: true }));

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
			export * from "./src/lib/search/query-utils";
			export { buildSearchConditions } from "./src/lib/search/conditions";
			export { schemaDialect } from "./src/db/dialect";
			export { createDb, getDb, schema } from "./src/db";
			export { getDatabaseConfig } from "./src/db/with-database";
			export { openExternalDatabase } from "./src/db/external";
			export { applyPendingMigrations } from "./src/lib/migrations/service";
		`,
		resolveDir: root,
		loader: "ts",
	},
	outfile: join(outDir, "search.mjs"),
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

const load = (name) => import(pathToFileURL(join(outDir, `${name}.mjs`)).href);
const search = await load("search");
const { SqliteDatabase } = await load("database");
const { applyMigrations } = await load("migrate");

// --- parseSearchQuery ---

test("operators are lifted out of the query and the rest is free text", () => {
	const parsed = search.parseSearchQuery("from:maya to:\"sam okoro\" subject:invoice has:attachment is:unread is:starred quarterly report");
	assert.equal(parsed.from, "maya");
	assert.equal(parsed.to, "sam okoro");
	assert.equal(parsed.subject, "invoice");
	assert.equal(parsed.hasAttachment, true);
	assert.equal(parsed.read, "unread");
	assert.equal(parsed.starred, true);
	assert.equal(parsed.text, "quarterly report");
	assert.equal(parsed.needsFullText, true);
});

test("operator names are case-insensitive and title: is an alias of subject:", () => {
	const parsed = search.parseSearchQuery("FROM:Maya Title:Offer HAS:Attachments IS:READ");
	assert.equal(parsed.from, "Maya");
	assert.equal(parsed.subject, "Offer");
	assert.equal(parsed.hasAttachment, true);
	assert.equal(parsed.read, "read");
	assert.equal(parsed.text, "");
});

test("an operator needs a word boundary before it and unknown values are dropped", () => {
	const embedded = search.parseSearchQuery("mailto:maya");
	assert.equal(embedded.to, undefined);
	assert.equal(embedded.text, "mailto:maya");
	const unknown = search.parseSearchQuery("is:important has:drive budget");
	assert.equal(unknown.read, undefined);
	assert.equal(unknown.starred, undefined);
	assert.equal(unknown.hasAttachment, undefined);
	assert.equal(unknown.text, "budget");
	// The last occurrence of a repeated operator wins.
	assert.equal(search.parseSearchQuery("from:a from:b").from, "b");
});

test("the bare :unread and :read forms still work", () => {
	assert.equal(search.parseSearchQuery(":unread budget").read, "unread");
	assert.equal(search.parseSearchQuery(":unread budget").text, "budget");
	assert.equal(search.parseSearchQuery("budget :read").read, "read");
	assert.equal(search.parseSearchQuery("budget:read").read, undefined);
	assert.equal(search.parseSearchQuery("budget:read").text, "budget:read");
});

test("only filters that are not text skip the full-text index", () => {
	assert.equal(search.parseSearchQuery("is:unread has:attachment after:2026-01-01").needsFullText, false);
	assert.equal(search.parseSearchQuery("").needsFullText, false);
	assert.equal(search.parseSearchQuery(undefined).text, "");
	assert.equal(search.parseSearchQuery("to:sam").needsFullText, true);
});

test("dates are calendar days in the caller's time zone; invalid dates are ignored", () => {
	const utc = search.parseSearchQuery("after:2026-09-01 before:2026/09/30");
	assert.equal(utc.after.toISOString(), "2026-09-01T00:00:00.000Z");
	assert.equal(utc.before.toISOString(), "2026-09-30T00:00:00.000Z");
	const saoPaulo = search.parseSearchQuery("newer:2026-09-15 older:2026-9-16", "America/Sao_Paulo");
	assert.equal(saoPaulo.after.toISOString(), "2026-09-15T03:00:00.000Z");
	assert.equal(saoPaulo.before.toISOString(), "2026-09-16T03:00:00.000Z");
	const invalid = search.parseSearchQuery("after:2026-02-30 before:tomorrow after:2026-13-01");
	assert.equal(invalid.after, undefined);
	assert.equal(invalid.before, undefined);
	assert.equal(invalid.text, "");
	// A later invalid value keeps the earlier valid one.
	assert.equal(search.parseSearchQuery("after:2026-01-02 after:nope").after.toISOString(), "2026-01-02T00:00:00.000Z");
	// An unknown time zone falls back instead of throwing.
	assert.ok(search.parseSearchQuery("after:2026-01-02", "Not/AZone").after instanceof Date);
});

// --- tokenizeSearchText ---

test("free text splits into phrases, negations and plain terms", () => {
	assert.deepEqual(search.tokenizeSearchText("budget \"exact phrase\" -draft -\"old copy\" --x"), [
		{ term: "budget", negate: false, phrase: false },
		{ term: "exact phrase", negate: false, phrase: true },
		{ term: "draft", negate: true, phrase: false },
		{ term: "old copy", negate: true, phrase: true },
		{ term: "x", negate: true, phrase: false },
	]);
	// An empty phrase is not a phrase, and a bare "-" or blank phrase yields nothing.
	assert.deepEqual(search.tokenizeSearchText("\"\" - \"  \""), [{ term: "\"\"", negate: false, phrase: false }]);
	assert.deepEqual(search.tokenizeSearchText(""), []);
});

// --- buildFtsMatch ---

/** The MATCH expression of a query that keeps matching rows; exclusions are asserted on `buildFtsMatch` directly. */
const fts = (raw) => {
	const match = search.buildFtsMatch(search.parseSearchQuery(raw));
	if (match === null) return null;
	return match.mode === "include" ? match.expression : { exclude: match.expression };
};

test("plain terms match by prefix, phrases and punctuated terms as whole words", () => {
	assert.equal(fts("inv"), "\"inv\"*");
	assert.equal(fts("\"exact phrase\""), "\"exact phrase\"");
	assert.equal(fts("maya@acme.test"), "\"maya acme test\"");
	assert.equal(fts("budget report"), "\"budget\"* AND \"report\"*");
});

test("column operators restrict their terms to the matching columns", () => {
	assert.equal(fts("subject:invoice"), "subject : (\"invoice\"*)");
	assert.equal(fts("from:\"maya okoro\""), "from_addr : (\"maya\"* AND \"okoro\"*)");
	assert.equal(fts("to:sam"), "{to_addr cc_addr} : (\"sam\"*)");
});

// FTS5 has no expression matching every row, so a query of only negations names the rows to exclude.
test("negations become a binary NOT, and a query of only negations becomes an exclusion", () => {
	assert.equal(fts("pizza -sushi -\"cold soup\""), "(\"pizza\"*) NOT (\"sushi\"* OR \"cold soup\")");
	assert.deepEqual(fts("-draft"), { exclude: "\"draft\"*" });
	assert.deepEqual(fts("-draft -\"old copy\" is:unread"), { exclude: "\"draft\"* OR \"old copy\"" });
	assert.equal(fts("-draft subject:invoice"), "(subject : (\"invoice\"*)) NOT (\"draft\"*)");
});

test("nothing to match returns null, and user input can never alter the FTS grammar", () => {
	assert.equal(fts(""), null);
	assert.equal(fts("is:unread"), null);
	assert.equal(fts("!!! ---"), null);
	assert.equal(fts("subject:..."), null);
	// Operators and quotes inside a term are separators, so every term is a quoted string.
	assert.equal(fts("a\"b"), "\"a b\"");
	assert.equal(fts("\"\""), null);
	assert.equal(fts("NEAR(x) OR"), "\"NEAR x\" AND \"OR\"*");
	for (const raw of SEARCH_QUERIES) {
		const match = search.buildFtsMatch(search.parseSearchQuery(raw));
		if (match === null) continue;
		assert.ok(match.mode === "include" || match.mode === "exclude", raw);
		const outsideStrings = match.expression.replace(/"(?:[^"]|"")*"/g, "");
		assert.match(outsideStrings, /^[\s*():{}a-z_]*(?:AND|OR|NOT|[\s*():{}a-z_])*$/, raw);
	}
});

// --- buildSearchConditions, executed ---

test("an empty query adds no condition", () => {
	assert.deepEqual(search.buildSearchConditions(""), []);
	assert.deepEqual(search.buildSearchConditions("   "), []);
	assert.equal(search.buildSearchConditions("is:unread").length, 1);
});

/**
 * Ids each query returns from mailbox mb1. The same answer is expected from the FTS5 index (prefix
 * word matching) and the LIKE fallback (substring matching) for this mailbox; `fts`/`like` override it.
 */
const expected = {
	"invoice": { all: ["m1"] },
	"inv": { all: ["m1"] },
	"from:maya": { all: ["m1"] },
	"to:maya": { all: ["m2"] },
	"subject:lunch": { all: ["m2"] },
	"title:lunch": { all: ["m2"] },
	"\"find the invoice\"": { all: ["m1"] },
	"\"invoice find\"": { all: [] },
	// Negations keep messages with an empty Cc or no text part (m1, m3, m4, m5, m6 have NULLs there).
	"-invoice": { all: ["m2", "m3", "m4", "m5", "m6"] },
	"-invoice -pizza": { all: ["m3", "m4", "m5"] },
	"-maya@acme.test": { all: ["m3", "m4", "m5", "m6"] },
	"-lunch is:read": { all: ["m3", "m4", "m5", "m6"] },
	"-logo to:kevin": { all: ["m3", "m5", "m6"] },
	"pizza -sushi": { all: ["m6"] },
	"lunch -sushi": { all: [] },
	"has:attachment": { all: ["m3"] },
	"is:unread": { all: ["m1"] },
	"is:starred": { all: ["m2"] },
	":read": { all: ["m2", "m3", "m4", "m5", "m6"] },
	"after:2026-09-15 before:2026-10-01": { all: ["m2"] },
	"maya@acme.test": { all: ["m1", "m2"] },
	"order": { all: ["m3"] },
	"100%": { all: ["m3"] },
	// FTS reads "a_b" as the words "a b"; LIKE escapes the wildcard. Either way "axb" must not match.
	"a_b": { all: [] },
	"to:lee": { all: ["m2"] },
	"from:maya subject:invoice is:unread": { all: ["m1"] },
	"": { all: ["m1", "m2", "m3", "m4", "m5", "m6"] },
	"\"unterminated": { all: [] },
	"a\"b": { all: [] },
	"( * NEAR AND OR NOT": { all: [] },
	"-": { all: ["m1", "m2", "m3", "m4", "m5", "m6"] },
};

function mismatches(results, flavour, queries) {
	const wrong = [];
	for (const query of queries) {
		const want = expected[query][flavour] ?? expected[query].all;
		if (JSON.stringify(results[query]) !== JSON.stringify(want)) wrong.push(`${JSON.stringify(query)}: got ${JSON.stringify(results[query])}, want ${JSON.stringify(want)}`);
	}
	return wrong;
}

function assertWorking(results, flavour) {
	assert.deepEqual(Object.keys(expected).sort(), [...SEARCH_QUERIES].sort(), "every scenario query has an expectation");
	assert.deepEqual(mismatches(results, flavour, SEARCH_QUERIES), [], flavour);
}

async function openSqliteMailbox(t) {
	const database = new SqliteDatabase(join(outDir, `${crypto.randomUUID()}.sqlite`));
	t.after(() => database.db.close());
	await applyMigrations(database, join(root, "drizzle/migrations"));
	const db = search.getDb({ DB: database });
	await seedSearchMailbox(db, search.schema);
	return db;
}

let postgresRun;
/** One PGlite run (migrations, seed, every query) in a child process, shared by the PostgreSQL tests. */
function runOnPostgres() {
	postgresRun ??= (() => {
		const result = spawnSync(process.execPath, [join(root, "tests/fixtures/search-postgres-runner.mjs"), join(outDir, "search.mjs")], {
			env: { ...process.env, MAILCLAW_DB_DIALECT: "postgres", DATABASE_URL: "", DATABASE_DRIVER: "" },
			encoding: "utf8",
			timeout: 110_000,
		});
		assert.equal(result.status, 0, result.stderr || result.error?.message);
		return JSON.parse(result.stdout);
	})();
	return postgresRun;
}

test("on SQLite the conditions query the FTS5 index", async (t) => {
	const db = await openSqliteMailbox(t);
	assert.equal(search.schemaDialect(), "sqlite");
	assertWorking(await runSearchQueries(db, search.schema, search.buildSearchConditions, { and, asc, eq }), "fts");
});

test("on SQLite the index follows updates and deletes through the migration triggers", async (t) => {
	const db = await openSqliteMailbox(t);
	const { messages } = search.schema;
	const ids = async (query) => (await db.select({ id: messages.id }).from(messages)
		.where(and(eq(messages.mailboxId, "mb1"), ...search.buildSearchConditions(query))).orderBy(asc(messages.id))).map((row) => row.id);
	await db.update(messages).set({ subject: "Quarterly figures" }).where(eq(messages.id, "m5"));
	assert.deepEqual(await ids("quarterly"), ["m5"]);
	assert.deepEqual(await ids("axb"), []);
	await db.delete(messages).where(eq(messages.id, "m1"));
	assert.deepEqual(await ids("invoice"), []);
});

// FTS5 matches no row for `""*`, so a negation-only query must exclude by rowid rather than MATCH a base.
test("on SQLite a query of only negations excludes by rowid and stays inside the caller's scope", async (t) => {
	const db = await openSqliteMailbox(t);
	const { messages } = search.schema;
	const [condition] = search.buildSearchConditions("-invoice");
	const query = db.select({ id: messages.id }).from(messages).where(and(eq(messages.mailboxId, "mb1"), condition)).orderBy(asc(messages.id));
	assert.match(query.toSQL().sql, /rowid NOT IN \(SELECT rowid FROM messages_fts WHERE messages_fts MATCH \?\)/);
	assert.deepEqual((await query).map((row) => row.id), ["m2", "m3", "m4", "m5", "m6"]);
	// Mailbox mb2's only message mentions the invoice, and nothing from it leaks into an unscoped exclusion.
	const other = await db.select({ id: messages.id }).from(messages).where(and(eq(messages.mailboxId, "mb2"), ...search.buildSearchConditions("-invoice")));
	assert.deepEqual(other, []);
});

test("on PostgreSQL the conditions fall back to escaped substring matching", { timeout: 120_000 }, () => {
	const { dialect, results } = runOnPostgres();
	assert.equal(dialect, "postgres");
	assertWorking(results, "like");
});
