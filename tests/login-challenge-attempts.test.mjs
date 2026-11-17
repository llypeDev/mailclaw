import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildSchema0088App } from "./fixtures/schema-0088-app.mjs";
import { challengeAttempts, challengeBeforeMigration } from "./fixtures/schema-0088-scenarios.mjs";

// src/lib/auth/login-challenge.ts: a login challenge (MFA step of /api/auth/login and /api/auth/device)
// allows MAX_LOGIN_CHALLENGE_ATTEMPTS second-factor tries, counted by a conditional UPDATE (migration 0088).
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(root, "tests", ".tmp-login-challenge-attempts-"));
after(() => rmSync(outDir, { recursive: true, force: true }));

const bundle = await buildSchema0088App(root, outDir);
const load = (name) => import(pathToFileURL(join(outDir, `${name}.mjs`)).href);
const app = await load("app");
const { SqliteDatabase } = await load("database");
const { applyMigrations } = await load("migrate");

async function sqliteEnv(t) {
	const database = new SqliteDatabase(join(outDir, `${crypto.randomUUID()}.sqlite`));
	t.after(() => database.db.close());
	await applyMigrations(database, join(root, "drizzle/migrations"));
	return { env: { DB: database }, database };
}

function runPostgres(scenario) {
	const run = spawnSync(process.execPath, [join(root, "tests/fixtures/schema-0088-runner.mjs"), bundle, scenario], {
		env: { ...process.env, MAILCLAW_DB_DIALECT: "postgres" },
		encoding: "utf8",
		timeout: 120_000,
	});
	assert.equal(run.status, 0, run.stderr);
	const { dialect, result } = JSON.parse(run.stdout);
	assert.equal(dialect, "postgres");
	return result;
}

function expectLimits(result) {
	assert.equal(app.MAX_LOGIN_CHALLENGE_ATTEMPTS, 5);
	assert.deepEqual(result.sequential, ["u1", "u1", "u1", "u1", "u1", null, null], "five tries, then the challenge is spent");
	assert.equal(result.peekAfterExhaustion, null, "a spent challenge cannot start a passkey ceremony either");
	assert.equal(result.racedAccepted, 5, "racing requests cannot share the last attempt");
	assert.deepEqual(result.peekDoesNotCount, Array(6).fill("u1"), "peeking counts nothing");
	assert.equal(result.afterPeeks, "u1");
	assert.equal(result.consumed, true);
	assert.equal(result.afterConsume, null);
	assert.equal(result.expired, null);
}

test("SQLite: a challenge allows five second-factor tries", async (t) => {
	const { env } = await sqliteEnv(t);
	expectLimits(await challengeAttempts(app, env));
});

test("SQLite: the counter starts at zero and only the matching challenge moves", async (t) => {
	const { env, database } = await sqliteEnv(t);
	database.db.prepare("INSERT INTO users (id, email, name, password_hash, created_at) VALUES ('u1', 'u1@example.test', 'U', 'x', 0)").run();
	const first = await app.createLoginChallenge(env, "u1");
	const second = await app.createLoginChallenge(env, "u1");
	await app.getLoginChallengeUserId(env, first);
	await app.getLoginChallengeUserId(env, first);
	const counts = database.db.prepare("SELECT attempts FROM login_challenges ORDER BY attempts").all().map((row) => row.attempts);
	assert.deepEqual(counts, [0, 2]);
	assert.equal(await app.getLoginChallengeUserId(env, second), "u1");
	assert.equal(await app.getLoginChallengeUserId(env, "mfa_unknown"), null);
});

// Without the column nothing is counted, but an admin with MFA can still sign in to apply the migration.
function expectUncounted(result) {
	assert.deepEqual(result, { tries: Array(7).fill("u1"), peek: "u1", consumed: true, afterConsume: null });
}

test("SQLite: before migration 0088 sign-in keeps working without a counter", async (t) => {
	const { env } = await sqliteEnv(t);
	expectUncounted(await challengeBeforeMigration(app, env));
});

test("PostgreSQL (PGlite): the same limits hold", () => {
	expectLimits(runPostgres("challengeAttempts"));
});

test("PostgreSQL (PGlite): before migration 0088 sign-in keeps working", () => {
	expectUncounted(runPostgres("challengeBeforeMigration"));
});
