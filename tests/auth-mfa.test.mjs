import assert from "node:assert/strict";
import test, { after, mock } from "node:test";
import { loadAppWithSqlite, seconds } from "./helpers/app-sqlite.mjs";

// src/lib/auth TOTP (RFC 4226/6238 vectors), the per-client rate limits, recovery codes and the MFA
// enrolment and login steps, against a migrated SQLite database. Nothing is stubbed: the second
// factor runs through the real users, sessions, mfa_recovery_codes and login_challenges tables.
const app = await loadAppWithSqlite({
	name: "auth-mfa",
	exports: [
		`export * from "./src/lib/auth/totp.ts";`,
		`export * from "./src/lib/auth/rate-limit.ts";`,
		`export * from "./src/lib/auth/recovery-codes.ts";`,
		`export * from "./src/lib/auth/mfa.ts";`,
		`export * from "./src/lib/auth/login-challenge.ts";`,
		`export { createSession, hashSessionToken } from "./src/lib/auth/session.ts";`,
	],
});
after(app.dispose);
const lib = app.lib;

// RFC 6238 appendix B and RFC 4226 appendix D use this ASCII secret for HMAC-SHA1.
const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

async function fixture(t) {
	const database = await app.openDatabase(t);
	const sql = database.db;
	const env = { DB: database };
	const now = seconds(new Date());
	const addUser = (id, { totpSecret = null, totpEnabled = false } = {}) => {
		sql.prepare("INSERT INTO users (id, email, name, password_hash, totp_secret, totp_enabled, created_at) VALUES (?, ?, ?, 'x', ?, ?, ?)")
			.run(id, `${id}@example.com`, id, totpSecret, totpEnabled ? 1 : 0, now);
	};
	const user = (id) => {
		const row = sql.prepare("SELECT id, email, totp_secret, totp_enabled, totp_confirmed_at, require_second_factor, passkey_count FROM users WHERE id = ?").get(id);
		return {
			id: row.id,
			email: row.email,
			totpSecret: row.totp_secret,
			totpEnabled: row.totp_enabled === 1,
			totpConfirmedAt: row.totp_confirmed_at === null ? null : new Date(row.totp_confirmed_at * 1000),
			requireSecondFactor: row.require_second_factor === 1,
			passkeyCount: row.passkey_count,
		};
	};
	const count = (table, where = "1 = 1", ...params) => sql.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${where}`).get(...params).n;
	return { database, sql, env, now, addUser, user, count };
}

test("base32 follows RFC 4648 without padding and decodes leniently", () => {
	const vectors = { "": "", f: "MY", fo: "MZXQ", foo: "MZXW6", foob: "MZXW6YQ", fooba: "MZXW6YTB", foobar: "MZXW6YTBOI" };
	for (const [plain, encoded] of Object.entries(vectors)) {
		assert.equal(lib.base32Encode(new TextEncoder().encode(plain)), encoded, plain);
		assert.equal(new TextDecoder().decode(lib.base32Decode(encoded)), plain, encoded);
	}
	assert.equal(lib.base32Encode(new TextEncoder().encode("12345678901234567890")), RFC_SECRET);
	// Authenticator apps show the key in groups and lower case; padding and spaces are ignored.
	assert.equal(new TextDecoder().decode(lib.base32Decode("mzxw 6ytb oi======")), "foobar");
	const secret = lib.generateTotpSecret();
	assert.match(secret, /^[A-Z2-7]{32}$/);
	assert.equal(lib.base32Decode(secret).length, 20);
	assert.notEqual(lib.generateTotpSecret(), secret);
});

test("HOTP matches the RFC 4226 appendix D values", async () => {
	const expected = ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"];
	for (const [counter, code] of expected.entries()) assert.equal(await lib.hotp(RFC_SECRET, counter), code, `counter ${counter}`);
});

test("TOTP matches the RFC 6238 appendix B SHA-1 values (last six digits)", async () => {
	const vectors = [
		[59, "287082"],
		[1111111109, "081804"],
		[1111111111, "050471"],
		[1234567890, "005924"],
		[2000000000, "279037"],
		[20000000000, "353130"],
	];
	for (const [time, code] of vectors) {
		assert.equal(await lib.totp(RFC_SECRET, time * 1000), code, `T = ${time}`);
		assert.equal(await lib.verifyTotp(RFC_SECRET, code, time * 1000), true, `verify T = ${time}`);
	}
	assert.equal(lib.totpCounter(59_999), 1);
	assert.equal(lib.totpCounter(60_000), 2);
});

test("verification accepts one step of clock drift either way, spaces, and nothing else", async () => {
	const at = 1111111111 * 1000;
	const counter = lib.totpCounter(at);
	const code = (delta) => lib.hotp(RFC_SECRET, counter + delta);
	assert.equal(await lib.verifyTotp(RFC_SECRET, await code(-1), at), true);
	assert.equal(await lib.verifyTotp(RFC_SECRET, await code(1), at), true);
	assert.equal(await lib.verifyTotp(RFC_SECRET, await code(-2), at), false);
	assert.equal(await lib.verifyTotp(RFC_SECRET, await code(2), at), false);
	assert.equal(await lib.verifyTotp(RFC_SECRET, "050 471", at), true);
	assert.equal(await lib.verifyTotp(RFC_SECRET, " 050471\n", at), true);
	for (const bad of ["", "05047", "0504710", "05047a", "050-471", "000000"]) {
		assert.equal(await lib.verifyTotp(RFC_SECRET, bad, at), false, JSON.stringify(bad));
	}
	assert.equal(lib.timingSafeEqual("123456", "123456"), true);
	assert.equal(lib.timingSafeEqual("123456", "123457"), false);
	assert.equal(lib.timingSafeEqual("12345", "123456"), false);
});

test("the otpauth URL carries the issuer, account and the profile apps implement", () => {
	const url = new URL(lib.buildOtpauthUrl({ issuer: "Acme Mail", account: "ana+x@example.com", secret: RFC_SECRET }));
	assert.equal(url.protocol, "otpauth:");
	assert.equal(url.host, "totp");
	assert.equal(url.pathname, "/Acme%20Mail:ana%2Bx%40example.com");
	assert.deepEqual(Object.fromEntries(url.searchParams), { secret: RFC_SECRET, issuer: "Acme Mail", algorithm: "SHA1", digits: "6", period: "30" });
});

function recordingLimiter(outcome = true) {
	const keys = [];
	return { keys, async limit({ key }) { keys.push(key); if (outcome instanceof Error) throw outcome; return { success: outcome }; } };
}
const request = (headers) => new Request("https://mail.example/api/auth/login", { method: "POST", headers });

test("login attempts are keyed by the trusted client IP and allowed without a limiter", async () => {
	assert.equal(await lib.allowLoginAttempt({}, request({})), true);
	const limiter = recordingLimiter();
	const env = { LOGIN_RATE_LIMIT: limiter };
	await lib.allowLoginAttempt(env, request({ "cf-connecting-ip": "203.0.113.7", "x-mailclaw-client-ip": "198.51.100.1", "x-forwarded-for": "10.0.0.1" }));
	await lib.allowLoginAttempt(env, request({ "x-mailclaw-client-ip": "198.51.100.1", "x-forwarded-for": "10.0.0.1" }));
	// The rightmost hop is the one the nearest proxy appended; a client controls the ones before it.
	await lib.allowLoginAttempt(env, request({ "x-forwarded-for": "1.1.1.1, 10.0.0.2 " }));
	await lib.allowLoginAttempt(env, request({}));
	assert.deepEqual(limiter.keys, ["203.0.113.7", "198.51.100.1", "10.0.0.2", "unknown"]);
	assert.equal(await lib.allowLoginAttempt({ LOGIN_RATE_LIMIT: recordingLimiter(false) }, request({})), false);
});

test("device sign-ins and bookings use their own buckets; a broken limiter fails open", async (t) => {
	const login = recordingLimiter();
	const device = recordingLimiter(false);
	const headers = { "cf-connecting-ip": "203.0.113.7" };
	assert.equal(await lib.allowDeviceLoginAttempt({ LOGIN_RATE_LIMIT: login, DEVICE_LOGIN_RATE_LIMIT: device }, request(headers)), false);
	assert.deepEqual(device.keys, ["device:203.0.113.7"]);
	assert.deepEqual(login.keys, []);
	// Without its own binding a device sign-in shares the login limiter, under its own key.
	assert.equal(await lib.allowDeviceLoginAttempt({ LOGIN_RATE_LIMIT: login }, request(headers)), true);
	assert.equal(await lib.allowDeviceLoginAttempt({}, request(headers)), true);
	assert.equal(await lib.allowBookingAttempt({ LOGIN_RATE_LIMIT: login, DEVICE_LOGIN_RATE_LIMIT: device }, request(headers)), true);
	assert.equal(await lib.allowBookingAttempt({}, request(headers)), true);
	assert.deepEqual(login.keys, ["device:203.0.113.7", "booking:203.0.113.7"]);

	const warn = t.mock.method(console, "warn", () => {});
	const broken = { LOGIN_RATE_LIMIT: recordingLimiter(new Error("binding down")) };
	assert.equal(await lib.allowLoginAttempt(broken, request(headers)), true);
	assert.equal(await lib.allowDeviceLoginAttempt(broken, request(headers)), true);
	assert.equal(await lib.allowBookingAttempt(broken, request(headers)), true);
	assert.equal(warn.mock.callCount(), 3);
});

test("recovery codes are stored hashed, typed loosely, and each works once", async (t) => {
	const f = await fixture(t);
	f.addUser("u1");
	f.addUser("u2");
	const codes = await lib.issueRecoveryCodes(f.env, "u1");
	assert.equal(codes.length, 8);
	assert.equal(new Set(codes).size, 8);
	for (const code of codes) assert.match(code, /^[a-hjkmnp-z2-9]{5}-[a-hjkmnp-z2-9]{5}$/);
	const stored = f.sql.prepare("SELECT code_hash FROM mfa_recovery_codes WHERE user_id = 'u1'").all().map((row) => row.code_hash);
	assert.equal(stored.length, 8);
	assert.ok(!stored.some((hash) => codes.some((code) => hash.includes(code.replace("-", "")))), "no code is stored in the clear");
	assert.ok(stored.includes(await lib.hashSessionToken(codes[0].replace("-", ""))));
	assert.equal(await lib.countUnusedRecoveryCodes(f.env, "u1"), 8);

	assert.equal(lib.normalizeRecoveryCode(" AbCdE-fGhJk "), "abcdefghjk");
	assert.equal(await lib.consumeRecoveryCode(f.env, "u2", codes[0]), false, "another user's code");
	assert.equal(await lib.consumeRecoveryCode(f.env, "u1", ` ${codes[0].toUpperCase().replace("-", " ")} `), true);
	assert.equal(await lib.consumeRecoveryCode(f.env, "u1", codes[0]), false, "a used code");
	assert.equal(await lib.consumeRecoveryCode(f.env, "u1", "aaaaa-aaaaa"), false);
	assert.equal(await lib.countUnusedRecoveryCodes(f.env, "u1"), 7);

	// Two requests racing with the same code: only one of them redeems it.
	const raced = await Promise.all([lib.consumeRecoveryCode(f.env, "u1", codes[1]), lib.consumeRecoveryCode(f.env, "u1", codes[1])]);
	assert.deepEqual(raced.sort(), [false, true]);
	assert.equal(await lib.countUnusedRecoveryCodes(f.env, "u1"), 6);

	// A new set replaces the old one, used and unused.
	const fresh = await lib.issueRecoveryCodes(f.env, "u1");
	assert.equal(await lib.countUnusedRecoveryCodes(f.env, "u1"), 8);
	assert.equal(f.count("mfa_recovery_codes", "user_id = 'u1'"), 8);
	assert.equal(await lib.consumeRecoveryCode(f.env, "u1", codes[2]), false);
	assert.equal(await lib.consumeRecoveryCode(f.env, "u1", fresh[0]), true);
});

test("enrolment stores an untrusted secret until a code from it is confirmed", async (t) => {
	const f = await fixture(t);
	f.addUser("u1");
	f.sql.prepare("INSERT INTO app_settings (id, app_name, updated_at) VALUES ('default', 'Acme Mail', ?) ON CONFLICT (id) DO UPDATE SET app_name = excluded.app_name").run(f.now);
	assert.deepEqual(await lib.getMfaStatus(f.env, f.user("u1")), { enabled: false, confirmedAt: null, recoveryCodesLeft: 0 });

	const enrolment = await lib.beginMfaEnrollment(f.env, f.user("u1"));
	assert.match(enrolment.secret, /^[A-Z2-7]{32}$/);
	assert.equal(new URL(enrolment.otpauthUrl).pathname, "/Acme%20Mail:u1%40example.com");
	assert.match(enrolment.qrSvg, /^<svg[\s\S]*<\/svg>\s*$/);
	let u1 = f.user("u1");
	assert.equal(u1.totpSecret, enrolment.secret);
	assert.equal(u1.totpEnabled, false);
	// An unconfirmed secret is not a second factor.
	assert.equal(await lib.verifySecondFactor(f.env, u1, await lib.totp(enrolment.secret)), null);

	const keep = await lib.createSession(f.env, "u1");
	await lib.createSession(f.env, "u1");
	f.sql.prepare("INSERT INTO api_keys (id, user_id, name, key_hash, prefix, scopes, kind, created_at) VALUES ('k1', 'u1', 'Phone', 'h', 'p', '[\"jmap\"]', 'device', ?)").run(f.now);
	assert.deepEqual(await lib.confirmMfaEnrollment(f.env, u1, "000000", keep), { ok: false, error: "That code did not match. Check the time on your device and try again." });
	assert.equal(f.count("sessions", "user_id = 'u1'"), 2);

	const confirmed = await lib.confirmMfaEnrollment(f.env, u1, await lib.totp(enrolment.secret), keep);
	assert.equal(confirmed.ok, true);
	assert.equal(confirmed.recoveryCodes.length, 8);
	u1 = f.user("u1");
	assert.equal(u1.totpEnabled, true);
	assert.equal(u1.requireSecondFactor, true);
	assert.ok(u1.totpConfirmedAt);
	// Other sessions and device keys predate the factor; the session that enrolled survives.
	assert.equal(f.count("sessions", "user_id = 'u1'"), 1);
	assert.equal(f.count("sessions", "token_hash = ?", await lib.hashSessionToken(keep)), 1);
	assert.equal(f.count("api_keys", "user_id = 'u1'"), 0);
	assert.deepEqual(await lib.getMfaStatus(f.env, u1), { enabled: true, confirmedAt: u1.totpConfirmedAt.toISOString(), recoveryCodesLeft: 8 });

	assert.deepEqual(await lib.confirmMfaEnrollment(f.env, u1, await lib.totp(enrolment.secret)), { ok: false, error: "Two-factor authentication is already on" });
	f.addUser("u2");
	assert.deepEqual(await lib.confirmMfaEnrollment(f.env, f.user("u2"), "123456"), { ok: false, error: "Start enrolment first" });
});

test("the second step takes a TOTP code or a recovery code once, and only for an enrolled account", async (t) => {
	const f = await fixture(t);
	const secret = lib.generateTotpSecret();
	f.addUser("u1", { totpSecret: secret, totpEnabled: true });
	const codes = await lib.issueRecoveryCodes(f.env, "u1");
	const u1 = f.user("u1");
	assert.equal(await lib.verifySecondFactor(f.env, u1, await lib.totp(secret)), "totp");
	assert.equal(await lib.verifySecondFactor(f.env, u1, codes[3]), "recovery");
	assert.equal(await lib.verifySecondFactor(f.env, u1, codes[3]), null);
	assert.equal(await lib.verifySecondFactor(f.env, u1, "nonsense"), null);

	// Recovery codes left over from an earlier enrolment are not a factor on their own.
	f.addUser("u2");
	const stale = await lib.issueRecoveryCodes(f.env, "u2");
	assert.equal(await lib.verifySecondFactor(f.env, f.user("u2"), stale[0]), null);
	assert.equal(await lib.countUnusedRecoveryCodes(f.env, "u2"), 8, "a refused code is not burnt");
});

// RFC 6238 section 5.2: a verifier SHOULD NOT accept the same OTP twice. verifySecondFactor claims the
// matched step in users.totp_last_step, so a code seen over a shoulder or phished does not work again.
test("a TOTP code that signed in once is not accepted again", async (t) => {
	const f = await fixture(t);
	const secret = lib.generateTotpSecret();
	f.addUser("u1", { totpSecret: secret, totpEnabled: true });
	const code = await lib.totp(secret);
	assert.equal(await lib.verifySecondFactor(f.env, f.user("u1"), code), "totp");
	assert.equal(await lib.verifySecondFactor(f.env, f.user("u1"), code), null);
});

test("turning TOTP off drops its codes and keeps the requirement only while a passkey remains", async (t) => {
	const f = await fixture(t);
	for (const id of ["u1", "u2"]) {
		f.addUser(id, { totpSecret: lib.generateTotpSecret(), totpEnabled: true });
		f.sql.prepare("UPDATE users SET require_second_factor = 1 WHERE id = ?").run(id);
		await lib.issueRecoveryCodes(f.env, id);
	}
	f.sql.prepare("INSERT INTO passkey_credentials (id, user_id, credential_id, credential_hash, public_key, device_type, name, created_at) VALUES ('p1', 'u2', 'c1', 'h1', 'key', 'singleDevice', 'Key', ?)").run(f.now);

	await lib.disableMfa(f.env, "u1");
	let row = f.user("u1");
	assert.deepEqual([row.totpSecret, row.totpEnabled, row.totpConfirmedAt, row.requireSecondFactor], [null, false, null, false]);
	assert.equal(f.count("mfa_recovery_codes", "user_id = 'u1'"), 0);

	await lib.disableMfa(f.env, "u2");
	row = f.user("u2");
	assert.equal(row.passkeyCount, 1);
	assert.equal(row.totpEnabled, false);
	assert.equal(row.requireSecondFactor, true, "the passkey still satisfies the requirement");
	assert.equal(f.count("mfa_recovery_codes", "user_id = 'u2'"), 0);
	assert.equal(f.count("mfa_recovery_codes"), 0);
});

test("a login challenge allows five second-factor tries, expires after five minutes and redeems once", async (t) => {
	const f = await fixture(t);
	const secret = lib.generateTotpSecret();
	f.addUser("u1", { totpSecret: secret, totpEnabled: true });
	const codes = await lib.issueRecoveryCodes(f.env, "u1");

	// The login flow: look the challenge up (one attempt), check the factor, consume on success.
	const attempt = async (token, code) => {
		const userId = await lib.getLoginChallengeUserId(f.env, token);
		if (!userId) return "expired";
		if (!(await lib.verifySecondFactor(f.env, f.user(userId), code))) return "wrong";
		return (await lib.consumeLoginChallenge(f.env, token)) ? "signed-in" : "raced";
	};

	const first = await lib.createLoginChallenge(f.env, "u1");
	assert.match(first, /^mfa/);
	assert.equal(f.count("login_challenges", "token_hash = ?", first), 0, "only the hash is stored");
	for (let index = 0; index < 4; index++) assert.equal(await attempt(first, "000000"), "wrong");
	assert.equal(await attempt(first, codes[0]), "signed-in", "the fifth try still counts");
	assert.equal(await attempt(first, await lib.totp(secret)), "expired", "a redeemed challenge is gone");

	const second = await lib.createLoginChallenge(f.env, "u1");
	for (let index = 0; index < lib.MAX_LOGIN_CHALLENGE_ATTEMPTS; index++) assert.equal(await attempt(second, "nonsense"), "wrong");
	assert.equal(await attempt(second, await lib.totp(secret)), "expired", "the sixth try is refused even with the right code");
	assert.equal(await lib.peekLoginChallengeUserId(f.env, second), null);
	assert.equal(await lib.countUnusedRecoveryCodes(f.env, "u1"), 7, "only the code that signed in was burnt");

	const start = new Date("2030-01-01T12:00:00Z");
	mock.timers.enable({ apis: ["Date"], now: start });
	t.after(() => mock.timers.reset());
	const third = await lib.createLoginChallenge(f.env, "u1");
	mock.timers.setTime(start.getTime() + 299_000);
	assert.equal(await lib.peekLoginChallengeUserId(f.env, third), "u1");
	assert.equal(await lib.getLoginChallengeUserId(f.env, third), "u1");
	mock.timers.setTime(start.getTime() + 301_000);
	assert.equal(await lib.peekLoginChallengeUserId(f.env, third), null);
	assert.equal(await lib.getLoginChallengeUserId(f.env, third), null);
	assert.equal(await lib.consumeLoginChallenge(f.env, third), false);
});
