import assert from "node:assert/strict";
import test, { after, mock } from "node:test";
import { loadAppWithSqlite, seconds } from "./helpers/app-sqlite.mjs";

// RFC 6238 section 5.2 replay protection: users.totp_last_step (migration 0090) records the last
// accepted step, claimed with a conditional UPDATE, against a migrated SQLite database.
const app = await loadAppWithSqlite({
	name: "totp-replay",
	exports: [
		`export * from "./src/lib/auth/totp.ts";`,
		`export * from "./src/lib/auth/mfa.ts";`,
	],
});
after(app.dispose);
const lib = app.lib;

const START = new Date("2030-01-01T12:00:10Z");

async function fixture(t) {
	const database = await app.openDatabase(t);
	const sql = database.db;
	const env = { DB: database };
	mock.timers.enable({ apis: ["Date"], now: START });
	t.after(() => mock.timers.reset());
	const addUser = (id, { totpSecret = null, totpEnabled = false } = {}) => {
		sql.prepare("INSERT INTO users (id, email, name, password_hash, totp_secret, totp_enabled, created_at) VALUES (?, ?, ?, 'x', ?, ?, ?)")
			.run(id, `${id}@example.com`, id, totpSecret, totpEnabled ? 1 : 0, seconds(START));
	};
	const user = (id) => {
		const row = sql.prepare("SELECT id, email, totp_secret, totp_enabled FROM users WHERE id = ?").get(id);
		return { id: row.id, email: row.email, totpSecret: row.totp_secret, totpEnabled: row.totp_enabled === 1 };
	};
	const lastStep = (id) => sql.prepare("SELECT totp_last_step AS step FROM users WHERE id = ?").get(id).step;
	return { sql, env, addUser, user, lastStep };
}

test("matchTotpStep names the step a code belongs to", async () => {
	const secret = lib.generateTotpSecret();
	const at = START.getTime();
	const counter = lib.totpCounter(at);
	for (const delta of [-1, 0, 1]) assert.equal(await lib.matchTotpStep(secret, await lib.hotp(secret, counter + delta), at), counter + delta);
	assert.equal(await lib.matchTotpStep(secret, await lib.hotp(secret, counter + 2), at), null);
	assert.equal(await lib.matchTotpStep(secret, "12345", at), null);
	assert.equal(await lib.verifyTotp(secret, await lib.hotp(secret, counter), at), true);
});

test("a step is accepted once, and never after a later one", async (t) => {
	const f = await fixture(t);
	const secret = lib.generateTotpSecret();
	f.addUser("u1", { totpSecret: secret, totpEnabled: true });
	const counter = lib.totpCounter(START.getTime());

	const current = await lib.hotp(secret, counter);
	assert.equal(await lib.verifySecondFactor(f.env, f.user("u1"), current), "totp");
	assert.equal(f.lastStep("u1"), counter);
	assert.equal(await lib.verifySecondFactor(f.env, f.user("u1"), current), null, "the same code again");
	// The previous step's code is still inside the drift window, but older than the one just used.
	assert.equal(await lib.verifySecondFactor(f.env, f.user("u1"), await lib.hotp(secret, counter - 1)), null);
	// A code from the next step (a phone clock slightly ahead) is newer, so it counts once.
	assert.equal(await lib.verifySecondFactor(f.env, f.user("u1"), await lib.hotp(secret, counter + 1)), "totp");
	assert.equal(f.lastStep("u1"), counter + 1);

	// Thirty seconds on, the code for that step was already used; the one after it was not.
	mock.timers.setTime(START.getTime() + 30_000);
	assert.equal(await lib.verifySecondFactor(f.env, f.user("u1"), await lib.totp(secret)), null);
	mock.timers.setTime(START.getTime() + 60_000);
	assert.equal(await lib.verifySecondFactor(f.env, f.user("u1"), await lib.totp(secret)), "totp");
	assert.equal(f.lastStep("u1"), counter + 2);
});

test("two requests racing with the same code: exactly one signs in", async (t) => {
	const f = await fixture(t);
	const secret = lib.generateTotpSecret();
	f.addUser("u1", { totpSecret: secret, totpEnabled: true });
	f.addUser("u2", { totpSecret: secret, totpEnabled: true });
	const code = await lib.totp(secret);
	const raced = await Promise.all(Array.from({ length: 4 }, () => lib.verifySecondFactor(f.env, f.user("u1"), code)));
	assert.deepEqual(raced.filter(Boolean), ["totp"]);
	assert.equal(raced.filter((result) => result === null).length, 3);
	// Steps are per account: another account using the same step is unaffected.
	assert.equal(await lib.verifySecondFactor(f.env, f.user("u2"), code), "totp");
});

test("the enrolment code is spent, and a new enrolment starts a fresh step history", async (t) => {
	const f = await fixture(t);
	f.addUser("u1");
	const first = await lib.beginMfaEnrollment(f.env, f.user("u1"));
	const code = await lib.totp(first.secret);
	const raced = await Promise.all([lib.confirmMfaEnrollment(f.env, f.user("u1"), code), lib.confirmMfaEnrollment(f.env, f.user("u1"), code)]);
	assert.deepEqual(raced.map((result) => result.ok).sort(), [false, true], "one confirmation issues recovery codes");
	assert.equal(f.lastStep("u1"), lib.totpCounter(START.getTime()));
	assert.equal(await lib.verifySecondFactor(f.env, f.user("u1"), code), null, "the code that confirmed cannot sign in");

	// Re-enrolling replaces the secret; its codes are not compared with the old secret's steps.
	await lib.disableMfa(f.env, "u1");
	const second = await lib.beginMfaEnrollment(f.env, f.user("u1"));
	assert.equal(f.lastStep("u1"), null);
	const confirmed = await lib.confirmMfaEnrollment(f.env, f.user("u1"), await lib.totp(second.secret));
	assert.equal(confirmed.ok, true);
});

test("before migration 0090 codes still verify, without replay protection", async (t) => {
	const f = await fixture(t);
	f.sql.exec("ALTER TABLE users DROP COLUMN totp_last_step");
	f.addUser("u1");
	const enrolment = await lib.beginMfaEnrollment(f.env, f.user("u1"));
	const confirmed = await lib.confirmMfaEnrollment(f.env, f.user("u1"), await lib.totp(enrolment.secret));
	assert.equal(confirmed.ok, true);
	const code = await lib.totp(enrolment.secret);
	assert.equal(await lib.verifySecondFactor(f.env, f.user("u1"), code), "totp");
	assert.equal(await lib.verifySecondFactor(f.env, f.user("u1"), code), "totp");
	assert.equal(await lib.verifySecondFactor(f.env, f.user("u1"), "000000"), null);
	assert.equal(await lib.verifySecondFactor(f.env, f.user("u1"), confirmed.recoveryCodes[0]), "recovery");
});
