import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createRequire } from "node:module";
import { installSqlite, loadFixture } from "./helpers/fixtures.mjs";

const require = createRequire(import.meta.url);
const bcrypt = require("bcryptjs");

const passwordFixture = await loadFixture({
	name: "session-security-password",
	entryPoint: "src/lib/auth/password-upgrade.ts",
	mocks: {
		"@/db": "export function getDb(){return globalThis.passwordUpgrade.db}",
	},
});
const originFixture = await loadFixture({ name: "session-security-origin", entryPoint: "src/lib/auth/origin.ts", mocks: {} });
const loginUtilsFixture = await loadFixture({ name: "session-security-login", entryPoint: "src/lib/auth/login-response-utils.ts", mocks: {} });
const cookieFixture = await loadFixture({
	name: "session-security-cookie",
	entryPoint: "src/lib/auth/session-cookie.ts",
	mocks: { "@/lib/auth/session": "export const SESSION_COOKIE='ep_session'" },
});
const clientFixture = await loadFixture({
	name: "session-security-client",
	entryPoint: "src/lib/auth/client.ts",
	mocks: {
		"@/lib/time/utils": "export function getUserTimeZone(){return 'UTC'}",
		"@/lib/time/client": "export function clearUserTimeZonePreference(){globalThis.tzCleared=(globalThis.tzCleared??0)+1}",
	},
});

const { upgradePasswordHashIfNeeded } = await passwordFixture.import();
const passwordModuleFixture = await loadFixture({ name: "session-security-password-module", entryPoint: "src/lib/auth/password.ts", mocks: {} });
const password = await passwordModuleFixture.import();
const origin = await originFixture.import();
const { shouldReturnSessionToken } = await loginUtilsFixture.import();
const { sessionCookieOptions } = await cookieFixture.import();
const utilsFixture = await loadFixture({ name: "session-security-client-utils", entryPoint: "src/lib/auth/client-utils.ts", mocks: {} });
const clientUtils = await utilsFixture.import();

let sqlite;
after(() => {
	sqlite?.close();
	delete globalThis.passwordUpgrade;
	for (const fixture of [passwordFixture, originFixture, loginUtilsFixture, cookieFixture, clientFixture, passwordModuleFixture, utilsFixture]) fixture.dispose();
});

test("new hashes are self-describing scrypt and verify", async () => {
	const hash = await password.hashPassword("correct horse battery staple");
	assert.match(hash, /^\$scrypt\$ln=14,r=8,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/);
	assert.equal(password.hasPasswordHash(hash), true);
	assert.equal(await password.verifyPassword("correct horse battery staple", hash), true);
	assert.equal(await password.verifyPassword("correct horse battery stapler", hash), false);
	assert.notEqual(await password.hashPassword("correct horse battery staple"), hash, "salted");
	assert.equal(password.passwordHashNeedsUpgrade(hash), false);
});

test("legacy bcrypt hashes still verify and are marked for upgrade", async () => {
	const legacy = bcrypt.hashSync("old-password", 4);
	assert.equal(password.hasPasswordHash(legacy), true);
	assert.equal(await password.verifyPassword("old-password", legacy), true);
	assert.equal(await password.verifyPassword("wrong", legacy), false);
	assert.equal(password.passwordHashNeedsUpgrade(legacy), true);
});

test("the passkey-only sentinel and malformed hashes never verify", async () => {
	assert.equal(password.hasPasswordHash(password.PASSWORDLESS_PASSWORD_HASH), false);
	assert.equal(await password.verifyPassword("!passkey-only", password.PASSWORDLESS_PASSWORD_HASH), false);
	assert.equal(await password.verifyPassword("x", null), false);
	assert.equal(await password.verifyPassword("x", ""), false);
	for (const bad of ["$scrypt$ln=30,r=8,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "$scrypt$ln=14,r=8$AAAA$AAAA", "$scrypt$ln=14,r=8,p=1$!!$AAAA", "plain-text"]) {
		assert.equal(password.hasPasswordHash(bad), false, bad);
		assert.equal(await password.verifyPassword("x", bad), false, bad);
	}
	const weaker = "$scrypt$ln=12,r=8,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
	assert.equal(password.hasPasswordHash(weaker), true);
	assert.equal(password.passwordHashNeedsUpgrade(weaker), true);
});

function setupUsers(hash) {
	sqlite?.close();
	sqlite = installSqlite("passwordUpgrade", {
		schema: `CREATE TABLE users (id TEXT PRIMARY KEY, password_hash TEXT NOT NULL); INSERT INTO users VALUES ('user', '${hash}');`,
	});
}

const storedHash = () => sqlite.prepare("SELECT password_hash AS hash FROM users WHERE id = 'user'").get().hash;

test("a successful sign-in replaces a bcrypt hash with scrypt", async () => {
	const legacy = bcrypt.hashSync("old-password", 4);
	setupUsers(legacy);
	await upgradePasswordHashIfNeeded({}, "user", "old-password", legacy);
	const upgraded = storedHash();
	assert.match(upgraded, /^\$scrypt\$/);
	assert.equal(await password.verifyPassword("old-password", upgraded), true);
});

test("the upgrade never overwrites a password changed in the meantime", async () => {
	const legacy = bcrypt.hashSync("old-password", 4);
	setupUsers("$2b$04$someoneelsechangeditxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");
	await upgradePasswordHashIfNeeded({}, "user", "old-password", legacy);
	assert.equal(storedHash(), "$2b$04$someoneelsechangeditxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");
});

test("an scrypt hash at the current cost is left alone", async () => {
	const current = await password.hashPassword("pw");
	setupUsers(current);
	await upgradePasswordHashIfNeeded({}, "user", "pw", current);
	assert.equal(storedHash(), current);
});

function request(path, { method = "POST", headers = {} } = {}) {
	return new Request(`https://mail.test${path}`, { method, headers });
}

test("the central guard checks only cookie-authenticated /api mutations", () => {
	const cookie = { Cookie: "ep_session=sess_abc" };
	assert.equal(origin.needsSessionOriginCheck(request("/api/messages", { headers: cookie })), true);
	assert.equal(origin.needsSessionOriginCheck(request("//api//messages", { headers: cookie }), "//api//messages"), true);
	assert.equal(origin.needsSessionOriginCheck(request("/api/auth/switch", { headers: { Cookie: "a=1; ep_accounts=t1.t2" } })), true);
	assert.equal(origin.needsSessionOriginCheck(request("/api/messages", { method: "GET", headers: cookie })), false);
	assert.equal(origin.needsSessionOriginCheck(request("/api/messages", { method: "HEAD", headers: cookie })), false);
	assert.equal(origin.needsSessionOriginCheck(request("/api/messages")), false, "no session cookie");
	assert.equal(origin.needsSessionOriginCheck(request("/api/messages", { headers: { Cookie: "other=1" } })), false);
	assert.equal(origin.needsSessionOriginCheck(request("/api/messages", { headers: { ...cookie, Authorization: "Bearer ep_key" } })), false);
	assert.equal(origin.needsSessionOriginCheck(request("/inbox", { headers: cookie })), false);
	for (const path of ["/api/inbound", "/api/inbound/resend", "/api/inbound/ses", "/api/public/booking/evt", "/api/i/abc.gif"]) {
		assert.equal(origin.needsSessionOriginCheck(request(path, { headers: cookie })), false, path);
	}
	assert.equal(origin.needsSessionOriginCheck(request("/api/inboundx", { headers: cookie })), true, "prefix must end at a segment");
});

test("cross-site and same-site cookie mutations are refused with 403", async () => {
	const cookie = "ep_session=sess_abc";
	const blocked = origin.rejectCrossSiteSessionMutation(request("/api/messages", { headers: { Cookie: cookie, "Sec-Fetch-Site": "cross-site" } }));
	assert.equal(blocked?.status, 403);
	assert.deepEqual(await blocked.json(), { error: "Cross-site request blocked" });
	assert.equal(origin.rejectCrossSiteSessionMutation(request("/api/messages", { headers: { Cookie: cookie, "Sec-Fetch-Site": "same-site" } }))?.status, 403);
	assert.equal(origin.rejectCrossSiteSessionMutation(request("/api/messages", { headers: { Cookie: cookie, Origin: "https://evil.test" } }))?.status, 403);
	assert.equal(origin.rejectCrossSiteSessionMutation(request("/api/messages", { headers: { Cookie: cookie } }))?.status, 403, "no origin evidence");
	assert.equal(origin.rejectCrossSiteSessionMutation(request("/api/messages", { headers: { Cookie: cookie, "Sec-Fetch-Site": "same-origin" } })), null);
	assert.equal(origin.rejectCrossSiteSessionMutation(request("/api/messages", { headers: { Cookie: cookie, Origin: "https://mail.test" } })), null);
	assert.equal(origin.rejectCrossSiteSessionMutation(request("/api/inbound/ses", { headers: { Cookie: cookie, "Sec-Fetch-Site": "cross-site" } })), null);
});

test("sign-in responses carry the token only for non-browser callers", () => {
	assert.equal(shouldReturnSessionToken(request("/api/auth/login")), true);
	assert.equal(shouldReturnSessionToken(request("/api/auth/login", { headers: { "Sec-Fetch-Site": "same-origin" } })), false);
	assert.equal(shouldReturnSessionToken(request("/api/auth/login", { headers: { Origin: "https://mail.test" } })), false);
	// What Node's fetch sends (scripts/import-gmail-takeout.mjs): no Sec-Fetch-Site, no Origin.
	assert.equal(shouldReturnSessionToken(request("/api/auth/login", { headers: { "Sec-Fetch-Mode": "cors", "User-Agent": "node" } })), true);
});

test("the session cookie stays Secure on https and works on plain-http self-hosting", () => {
	const previous = process.env.NODE_ENV;
	process.env.NODE_ENV = "production";
	try {
		assert.equal(sessionCookieOptions(new Request("https://mail.test/api/auth/login")).secure, true);
		assert.equal(sessionCookieOptions(new Request("http://10.0.0.5:3000/api/auth/login")).secure, false);
		assert.equal(sessionCookieOptions(new Request("http://app:3000/api/auth/login", { headers: { "X-Forwarded-Proto": "https" } })).secure, true);
		const options = sessionCookieOptions(new Request("https://mail.test/"), 0);
		assert.deepEqual({ ...options, secure: undefined }, { httpOnly: true, secure: undefined, sameSite: "lax", path: "/", maxAge: 0 });
	} finally {
		process.env.NODE_ENV = previous;
	}
	assert.equal(sessionCookieOptions(new Request("https://mail.test/")).secure, previous === "production");
});

test("session markers are random, non-secret and stable for a legacy token", () => {
	const marker = clientUtils.createSessionMarker();
	assert.match(marker, /^s1\.[0-9a-f]{24}$/);
	assert.notEqual(clientUtils.createSessionMarker(), marker);
	const legacy = clientUtils.legacySessionMarker("sess_abcdefghijklmnopqrstu");
	assert.match(legacy, /^l1\.[0-9a-f]{8}$/);
	assert.equal(clientUtils.legacySessionMarker("sess_abcdefghijklmnopqrstu"), legacy);
	assert.notEqual(clientUtils.legacySessionMarker("sess_abcdefghijklmnopqrstv"), legacy);
	assert.equal(legacy.includes("sess_"), false);
	const store = (entries) => ({ getItem: (key) => entries[key] ?? null });
	assert.equal(clientUtils.readSessionMarker(store({})), null);
	assert.equal(clientUtils.readSessionMarker(store({ "mailclaw-session-token": "sess_abcdefghijklmnopqrstu" })), legacy);
	assert.equal(clientUtils.readSessionMarker(store({ "mailclaw-session": "s1.x", "mailclaw-session-token": "t" })), "s1.x");
});

test("legacy migration keeps the token unless the cookie provably took over", () => {
	const decide = clientUtils.decideLegacyMigration;
	assert.deepEqual(decide({ status: 200, userId: "u1" }, { status: 200, userId: "u1" }), { kind: "migrated" });
	assert.deepEqual(decide({ status: 200, userId: "u1" }, { status: 401 }), { kind: "kept" }, "Secure cookie dropped over http");
	assert.deepEqual(decide({ status: 401 }, { status: 200, userId: "u2" }), { kind: "replaced" });
	assert.deepEqual(decide({ status: 401 }, { status: 401 }), { kind: "dropped" });
	assert.deepEqual(decide(null, null), { kind: "kept" });
	assert.deepEqual(decide({ status: 500 }, { status: 200, userId: "u1" }), { kind: "kept" });
});

function installBrowser(initial = {}) {
	const entries = new Map(Object.entries(initial));
	const events = [];
	const requests = [];
	globalThis.localStorage = {
		getItem: (key) => entries.get(key) ?? null,
		setItem: (key, value) => entries.set(key, String(value)),
		removeItem: (key) => entries.delete(key),
	};
	globalThis.window = {
		dispatchEvent: (event) => events.push(event.detail),
		location: { assign() {} },
	};
	return { entries, events, requests };
}

test("the web client stores a marker, never the token, and moves legacy tokens into the cookie", async (t) => {
	t.after(() => { delete globalThis.window; delete globalThis.localStorage; delete globalThis.fetch; });
	const browser = installBrowser({ "mailclaw-session-token": "sess_legacytokenvalue123" });
	globalThis.fetch = async (input, init = {}) => {
		const headers = new Headers(init.headers);
		browser.requests.push({ url: String(input), method: init.method ?? "GET", authorization: headers.get("Authorization") });
		if (String(input) === "/api/auth/session") return Response.json({ authenticated: true, userId: "u1" });
		return Response.json({ ok: true });
	};
	const client = await clientFixture.import();
	const before = client.getClientSessionToken();
	assert.match(before, /^l1\./);
	await client.authFetch("/api/messages");
	assert.deepEqual(browser.requests.map(({ url, method, authorization }) => [url, method, authorization]), [
		["/api/auth/session", "POST", "Bearer sess_legacytokenvalue123"],
		["/api/auth/session", "GET", null],
		["/api/messages", "GET", null],
	]);
	assert.equal(browser.entries.has("mailclaw-session-token"), false);
	assert.equal(client.getClientSessionToken(), before, "the move does not look like an account switch");
	assert.deepEqual(browser.events, []);

	const login = await client.persistAuthSession(Response.json({ ok: true, authenticated: true, redirect: "/inbox" }));
	assert.equal(login.authenticated, true);
	const marker = client.getClientSessionToken();
	assert.match(marker, /^s1\./);
	assert.deepEqual(browser.events, [{ authenticated: true }]);
	assert.equal([...browser.entries.values()].some((value) => value.includes("sess_")), false);

	await client.persistAuthSession(Response.json({ ok: true, mfaRequired: true, challengeToken: "c" }));
	assert.equal(client.getClientSessionToken(), marker, "an MFA challenge is not a session");

	client.setClientSessionToken("sess_from_switch_route");
	assert.notEqual(client.getClientSessionToken(), marker);
	assert.equal([...browser.entries.values()].includes("sess_from_switch_route"), false);

	client.clearClientSessionToken();
	assert.equal(client.getClientSessionToken(), null);
	assert.equal(client.getAuthHeaders().has("Authorization"), false);
});

test("the CSP refuses inline event-handler attributes", async () => {
	const headersFixture = await loadFixture({ name: "session-security-headers", entryPoint: "src/lib/security/headers.ts", mocks: {} });
	try {
		const { getSecurityHeaders } = await headersFixture.import();
		const csp = getSecurityHeaders().find((header) => header.key === "Content-Security-Policy").value;
		assert.match(csp, /(?:^|; )script-src-attr 'none'(?:;|$)/);
		assert.match(csp, /(?:^|; )object-src 'none'(?:;|$)/);
	} finally {
		headersFixture.dispose();
	}
});
