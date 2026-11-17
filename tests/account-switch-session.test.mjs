import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";
import { loadFixture } from "./helpers/fixtures.mjs";

// Account switch and logout hand the next session to browsers only as the
// httpOnly cookie, like a sign-in; the token is in the JSON for non-browser
// callers only, and the cookies are Secure only over HTTPS.

const serverMocks = {
	"next/server": `
		class CookieJar {
			constructor() { this.map = new Map(); }
			set(name, value, options) { this.map.set(name, { name, value, ...options }); }
			get(name) { return this.map.get(name); }
		}
		export class NextResponse extends Response {
			constructor(body, init) { super(body, init); this.cookies = new CookieJar(); }
			static json(data, init) {
				return new NextResponse(JSON.stringify(data), { ...init, headers: { "content-type": "application/json" } });
			}
		}`,
	"next/headers": `export async function cookies() {
		const jar = globalThis.accountSwitch.jar;
		return { get: (name) => (name in jar ? { name, value: jar[name] } : undefined) };
	}`,
	"@/lib/cloudflare": "export function getEnv() { return {}; }",
	"@/lib/auth/session": `
		export const SESSION_COOKIE = "ep_session";
		export async function hashSessionToken(token) { return "h:" + token; }
		export async function deleteSession(_env, token) { globalThis.accountSwitch.deleted.push(token); }
		export async function getUserFromSession(_env, token) {
			const row = globalThis.accountSwitch.sessions.find((entry) => entry.token === token);
			return row ? { id: row.userId } : null;
		}`,
	"@/lib/auth/activity": "export async function recordAuthActivity() {}",
	"@/db": `export function getDb() {
		const rows = () => globalThis.accountSwitch.sessions.map(({ token, userId }) => ({
			tokenHash: "h:" + token,
			user: { id: userId, email: userId + "@example.com", name: userId, avatarKey: null, disabled: false },
		}));
		const chain = { from: () => chain, innerJoin: () => chain, where: async () => rows() };
		return { select: () => chain };
	}`,
	"@/db/schema": "export const sessions = {}; export const users = {};",
	"drizzle-orm": "export const and = () => null, eq = () => null, gt = () => null, inArray = () => null;",
};

const switchFixture = await loadFixture({ name: "account-switch-route", entryPoint: "src/app/api/auth/switch/route.ts", mocks: serverMocks });
const logoutFixture = await loadFixture({ name: "account-logout-route", entryPoint: "src/app/api/auth/logout/route.ts", mocks: serverMocks });
const accountsFixture = await loadFixture({ name: "account-switch-accounts", entryPoint: "src/lib/auth/accounts.ts", mocks: serverMocks });

const clientMocks = {
	"@/lib/auth/client": `
		export async function authFetch() { return globalThis.accountClient.response(); }
		export function markClientSessionActive() { globalThis.accountClient.calls.push("mark"); }
		export function clearClientSessionToken() { globalThis.accountClient.calls.push("clear"); }`,
	"@/lib/push/app-badge": "export function setAppBadgeCount() {}",
};
const accountsClientFixture = await loadFixture({ name: "account-switch-client", entryPoint: "src/lib/auth/accounts-client.ts", mocks: clientMocks });
const logoutClientFixture = await loadFixture({ name: "account-logout-client", entryPoint: "src/lib/auth/logout.ts", mocks: clientMocks });

const switchRoute = await switchFixture.import();
const logoutRoute = await logoutFixture.import();
const accounts = await accountsFixture.import();
const { switchBrowserAccount } = await accountsClientFixture.import();
const { logoutClientSession } = await logoutClientFixture.import();

const previousNodeEnv = process.env.NODE_ENV;
process.env.NODE_ENV = "production";

after(() => {
	process.env.NODE_ENV = previousNodeEnv;
	delete globalThis.accountSwitch;
	delete globalThis.accountClient;
	for (const fixture of [switchFixture, logoutFixture, accountsFixture, accountsClientFixture, logoutClientFixture]) fixture.dispose();
});

beforeEach(() => {
	globalThis.accountSwitch = {
		jar: { ep_session: "tok-a", ep_accounts: "tok-a.tok-b" },
		sessions: [{ token: "tok-a", userId: "user-a" }, { token: "tok-b", userId: "user-b" }],
		deleted: [],
	};
});

const browserHeaders = { "Sec-Fetch-Site": "same-origin", Origin: "https://mail.example" };

function post(url, { headers = {}, body } = {}) {
	return new Request(url, {
		method: "POST",
		headers: { "Content-Type": "application/json", ...headers },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
}

test("a browser switch gets the session only as the cookie", async () => {
	const response = await switchRoute.POST(post("https://mail.example/api/auth/switch", { headers: browserHeaders, body: { userId: "user-b" } }));
	assert.equal(response.status, 200);
	const data = await response.json();
	assert.equal(data.authenticated, true);
	assert.equal("token" in data, false);
	assert.equal(response.cookies.get("ep_session").value, "tok-b");
	assert.equal(response.cookies.get("ep_session").httpOnly, true);
	assert.equal(response.cookies.get("ep_session").secure, true);
	assert.equal(response.cookies.get("ep_accounts").secure, true);
	assert.equal(response.headers.get("Cache-Control"), "no-store");
});

test("a non-browser switch still receives the token", async () => {
	const response = await switchRoute.POST(post("https://mail.example/api/auth/switch", { body: { userId: "user-b" } }));
	const data = await response.json();
	assert.equal(data.authenticated, true);
	assert.equal(data.token, "tok-b");
});

test("switch cookies are not Secure over plain http, and cross-site or unknown targets are refused", async () => {
	const http = await switchRoute.POST(post("http://localhost:3000/api/auth/switch", {
		headers: { "Sec-Fetch-Site": "same-origin", Origin: "http://localhost:3000" },
		body: { userId: "user-b" },
	}));
	assert.equal(http.status, 200);
	assert.equal(http.cookies.get("ep_session").secure, false);
	assert.equal(http.cookies.get("ep_accounts").secure, false);

	const crossSite = await switchRoute.POST(post("https://mail.example/api/auth/switch", {
		headers: { "Sec-Fetch-Site": "cross-site", Origin: "https://evil.example" },
		body: { userId: "user-b" },
	}));
	assert.equal(crossSite.status, 403);

	const unknown = await switchRoute.POST(post("https://mail.example/api/auth/switch", { headers: browserHeaders, body: { userId: "user-z" } }));
	assert.equal(unknown.status, 401);
	assert.equal("token" in (await unknown.json()), false);
});

test("logout promotes the next account through the cookie only, for browsers", async () => {
	const response = await logoutRoute.POST(post("https://mail.example/api/auth/logout", { headers: browserHeaders }));
	const data = await response.json();
	assert.deepEqual(globalThis.accountSwitch.deleted, ["tok-a"]);
	assert.equal(data.authenticated, true);
	assert.equal(data.redirect, "/inbox");
	assert.equal("token" in data, false);
	assert.equal(response.cookies.get("ep_session").value, "tok-b");
	assert.equal(response.cookies.get("ep_session").secure, true);
	assert.equal(response.cookies.get("ep_accounts").value, "tok-b");
});

test("a non-browser logout with another account receives its token", async () => {
	const response = await logoutRoute.POST(post("https://mail.example/api/auth/logout", { headers: { Authorization: "Bearer tok-a" } }));
	const data = await response.json();
	assert.equal(data.authenticated, true);
	assert.equal(data.token, "tok-b");
});

test("logout of the last account clears both cookies, over http without Secure", async () => {
	globalThis.accountSwitch.jar = { ep_session: "tok-a", ep_accounts: "tok-a" };
	const response = await logoutRoute.POST(post("http://localhost:3000/api/auth/logout", {
		headers: { "Sec-Fetch-Site": "same-origin", Origin: "http://localhost:3000" },
	}));
	const data = await response.json();
	assert.equal(data.authenticated, false);
	assert.equal("token" in data, false);
	assert.equal(response.cookies.get("ep_session").value, "");
	assert.equal(response.cookies.get("ep_session").maxAge, 0);
	assert.equal(response.cookies.get("ep_session").secure, false);
	assert.equal(response.cookies.get("ep_accounts").maxAge, 0);
});

test("the accounts cookie follows the request scheme, or the session cookie beside it", async () => {
	assert.equal(accounts.cookieOptions(new Request("http://localhost:3000/")).secure, false);
	assert.equal(accounts.cookieOptions(new Request("https://mail.example/")).secure, true);
	assert.equal(accounts.cookieOptions(new Request("http://app:3000/", { headers: { "X-Forwarded-Proto": "https" } })).secure, true);
	assert.equal(accounts.cookieOptions(new Request("http://localhost:3000/"), 0).maxAge, 0);
	assert.equal(accounts.cookieOptions().secure, true, "no request keeps the production default");

	const jar = new Map();
	const response = { cookies: { set: (name, value, options) => jar.set(name, { value, ...options }), get: (name) => jar.get(name) } };
	response.cookies.set("ep_session", "tok-b", { secure: false });
	await accounts.rememberLogin({}, response, "tok-a", "tok-b");
	assert.equal(jar.get("ep_accounts").secure, false);
	assert.equal(jar.get("ep_accounts").value, "tok-a.tok-b");

	await accounts.rememberLogin({}, response, "tok-a", "tok-b", undefined, new Request("https://mail.example/"));
	assert.equal(jar.get("ep_accounts").secure, true);
});

test("the web client accepts a switch or logout hand-off without a token", async () => {
	globalThis.accountClient = { calls: [], response: () => Response.json({ ok: true, authenticated: true, redirect: "/inbox" }) };
	assert.equal(await switchBrowserAccount("user-b"), null);
	assert.deepEqual(globalThis.accountClient.calls, ["mark"]);

	globalThis.accountClient = { calls: [], response: () => Response.json({ error: "Sign in again to use this account" }, { status: 401 }) };
	assert.equal(await switchBrowserAccount("user-z"), "Sign in again to use this account");
	assert.deepEqual(globalThis.accountClient.calls, []);

	globalThis.accountClient = { calls: [], response: () => Response.json({ ok: true, authenticated: true, redirect: "/inbox" }) };
	assert.equal(await logoutClientSession(), true);
	assert.deepEqual(globalThis.accountClient.calls, ["clear", "mark"]);

	globalThis.accountClient = { calls: [], response: () => Response.json({ ok: true, authenticated: false }) };
	assert.equal(await logoutClientSession(), false);
	assert.deepEqual(globalThis.accountClient.calls, ["clear"]);

	globalThis.accountClient = { calls: [], response: () => { throw new Error("offline"); } };
	assert.equal(await logoutClientSession(), false);
	assert.deepEqual(globalThis.accountClient.calls, ["clear"]);
});
