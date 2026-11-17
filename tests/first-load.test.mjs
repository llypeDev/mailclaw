import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after, beforeEach } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

// First dashboard load: the bootstrap request seeds the session, mailbox and flag caches; the locale
// catalog is read once per isolate; the favicon stays a static asset without a custom icon.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(tmpdir(), "mailclaw-first-load-"));
after(() => rmSync(outDir, { recursive: true, force: true }));
const outfile = join(outDir, "first-load.mjs");

// A minimal browser: the client modules read `window`, `localStorage` and `fetch` when they load.
const storage = new Map();
const browser = new EventTarget();
browser.location = { protocol: "https:", assign() {} };
browser.fetch = (...args) => globalThis.fetch(...args);
globalThis.window = browser;
globalThis.localStorage = {
	getItem: (key) => storage.get(key) ?? null,
	setItem: (key, value) => storage.set(key, String(value)),
	removeItem: (key) => storage.delete(key),
};
let requests = [];
let respond = () => Response.json({ error: "unexpected" }, { status: 500 });
globalThis.fetch = async (input, init = {}) => {
	const url = String(input);
	requests.push({ url, authorization: new Headers(init.headers).get("Authorization") });
	return respond(url);
};
globalThis.assetReads = 0;

await build({
	stdin: {
		contents: `
			export * from "./src/lib/i18n/catalog-store";
			export { loadServerMessages } from "./src/lib/i18n/server";
			export * from "./src/lib/bootstrap/utils";
			export { peekBootstrapPart, rememberBootstrapPart } from "./src/lib/bootstrap/client";
			export { fetchSessionInfo, clearCurrentUserCache, updateCachedSessionUser, peekSessionInfo } from "./src/hooks/use-current-user";
			export { fetchMailboxOptions, clearMailboxesCache } from "./src/components/mailbox-provider-utils";
			export { brandingIconHref, DEFAULT_ICON_HREF } from "./src/app/home-server-icon-utils";
		`,
		resolveDir: root,
		loader: "ts",
	},
	outfile,
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node22",
	logLevel: "silent",
	alias: { "@": join(root, "src") },
	plugins: [{
		name: "first-load-stubs",
		setup(builder) {
			builder.onResolve({ filter: /^(next\/headers|@\/lib\/cloudflare)$/ }, (args) => ({ path: args.path, namespace: "stub" }));
			builder.onLoad({ filter: /.*/, namespace: "stub" }, ({ path }) => ({
				contents: path === "next/headers"
					? "export async function cookies() { return { get() { return undefined; } }; }"
					: `export function getEnv() { return { ASSETS: { fetch: async (url) => {
						globalThis.assetReads += 1;
						if (globalThis.failAssets) return new Response("down", { status: 503 });
						return Response.json({ "navigation.inbox": "Entrada", read: globalThis.assetReads });
					} } }; }`,
			}));
		},
	}],
});
const mod = await import(pathToFileURL(outfile).href);

const signedIn = {
	session: { user: { id: "u1", email: "a@example.com", name: "Ana", role: "admin", isPrimaryAdmin: true, keyboardShortcutsEnabled: false }, hasMailboxes: true, isSetup: true },
	mailboxes: [{ id: "mbx1", domainId: "d1", localPart: "a", hostname: "example.com", displayName: "Ana", userId: "u1", type: "personal", isPrimary: true, senderAddresses: ["a@example.com"] }],
	canCreateShared: true,
	assistantEnabled: false,
	dnsSkippedDomains: [{ id: "d1", hostname: "example.com" }],
};

beforeEach(() => {
	requests = [];
	storage.clear();
	mod.clearCurrentUserCache();
	mod.clearMailboxesCache();
	delete browser[mod.EARLY_BOOTSTRAP_GLOBAL];
});

test("the first session read uses the response the page started early and seeds the other caches", async () => {
	respond = () => Response.json({ error: "no request expected" }, { status: 500 });
	browser[mod.EARLY_BOOTSTRAP_GLOBAL] = { at: Date.now(), response: Promise.resolve(Response.json(signedIn)) };
	const info = await mod.fetchSessionInfo({ fresh: true });
	assert.equal(info.status, 200);
	assert.equal(info.user.email, "a@example.com");
	assert.equal(info.user.keyboardShortcutsEnabled, false);
	assert.deepEqual(requests, [], "the early response stands in for the request");
	assert.equal(browser[mod.EARLY_BOOTSTRAP_GLOBAL], undefined, "the early response is handed out once");

	const mailboxes = await mod.fetchMailboxOptions();
	assert.deepEqual(mailboxes.map((mailbox) => mailbox.id), ["mbx1"]);
	assert.equal("userId" in mailboxes[0], false, "seeded items are reduced like /api/mailboxes answers");
	assert.equal(mod.peekBootstrapPart("assistantEnabled", 60_000), false);
	assert.deepEqual(mod.peekBootstrapPart("dnsSkippedDomains", 60_000), [{ id: "d1", hostname: "example.com" }]);
	assert.equal(storage.get("mailclaw-assistant-enabled"), "false");
	assert.deepEqual(requests, []);

	// Later refreshes only need the session endpoint.
	respond = (url) => url === "/api/auth/me" ? Response.json(signedIn.session) : Response.json({}, { status: 500 });
	await mod.fetchSessionInfo({ fresh: true });
	assert.deepEqual(requests.map((request) => request.url), ["/api/auth/me"]);
});

test("without an early response the bootstrap is requested, and a 401 is retried through authFetch", async () => {
	respond = (url) => url === "/api/bootstrap" ? Response.json({ error: "Unauthorized" }, { status: 401 }) : Response.json({}, { status: 500 });
	const info = await mod.fetchSessionInfo({ fresh: true });
	assert.equal(info.status, 401);
	// The retry is how a session still held by an older client (a stored bearer token) is honoured.
	assert.deepEqual(requests.filter((request) => request.url === "/api/bootstrap").length, 2);
	assert.equal(requests.some((request) => request.url === "/api/auth/me"), false, "a definite 401 needs no second endpoint");
	assert.equal(mod.peekSessionInfo(), null);
});

test("a server without the bootstrap route still answers the session through /api/auth/me", async () => {
	respond = (url) => url === "/api/auth/me" ? Response.json(signedIn.session) : new Response("Not found", { status: 404 });
	const info = await mod.fetchSessionInfo({ fresh: true });
	assert.equal(info.status, 200);
	assert.deepEqual(requests.map((request) => request.url), ["/api/bootstrap", "/api/auth/me"]);
	assert.equal(mod.peekBootstrapPart("assistantEnabled", 60_000), undefined);
});

test("a stale early response is ignored", async () => {
	browser[mod.EARLY_BOOTSTRAP_GLOBAL] = { at: Date.now() - mod.EARLY_BOOTSTRAP_MAX_AGE_MS - 1, response: Promise.resolve(Response.json({ error: "old" }, { status: 500 })) };
	respond = (url) => url === "/api/bootstrap" ? Response.json(signedIn) : Response.json({}, { status: 500 });
	const info = await mod.fetchSessionInfo({ fresh: true });
	assert.equal(info.status, 200);
	assert.deepEqual(requests.map((request) => request.url), ["/api/bootstrap"]);
});

test("a saved setting updates the cached session", async () => {
	browser[mod.EARLY_BOOTSTRAP_GLOBAL] = { at: Date.now(), response: Promise.resolve(Response.json(signedIn)) };
	await mod.fetchSessionInfo({ fresh: true });
	mod.updateCachedSessionUser({ keyboardShortcutsEnabled: true });
	assert.equal(mod.peekSessionInfo().user.keyboardShortcutsEnabled, true);
});

test("the early script starts one cookie-only request and never throws", async () => {
	respond = () => Response.json(signedIn);
	new Function(mod.earlyBootstrapScript)();
	const first = browser[mod.EARLY_BOOTSTRAP_GLOBAL];
	new Function(mod.earlyBootstrapScript)();
	assert.equal(browser[mod.EARLY_BOOTSTRAP_GLOBAL], first, "a second run does not start another request");
	assert.deepEqual(requests, [{ url: "/api/bootstrap", authorization: null }]);
	assert.equal((await first.response).status, 200);
	respond = () => { throw new TypeError("offline"); };
	delete browser[mod.EARLY_BOOTSTRAP_GLOBAL];
	new Function(mod.earlyBootstrapScript)();
	assert.equal(await browser[mod.EARLY_BOOTSTRAP_GLOBAL].response, null, "a network failure resolves to null");
});

test("the DNS banner applies only to accounts that own or manage domains", () => {
	assert.equal(mod.canSeeDnsSkippedBanner(null), false);
	assert.equal(mod.canSeeDnsSkippedBanner({ role: "user" }), false);
	assert.equal(mod.canSeeDnsSkippedBanner({ role: "user", canManageMailboxes: true }), true);
	assert.equal(mod.canSeeDnsSkippedBanner({ role: "user", canManageDomains: true }), true);
	assert.equal(mod.canSeeDnsSkippedBanner({ role: "admin" }), true);
});

test("the server reads and parses a locale catalog once per isolate and retries after a failure", async () => {
	globalThis.assetReads = 0;
	globalThis.failAssets = true;
	assert.equal(await mod.loadServerMessages("pt-PT"), undefined, "an unreadable catalog falls back to English");
	globalThis.failAssets = false;
	const first = await mod.loadServerMessages("pt-PT");
	const second = await mod.loadServerMessages("pt-PT");
	assert.equal(first["navigation.inbox"], "Entrada");
	assert.equal(second, first, "the parsed catalog is shared");
	assert.equal(globalThis.assetReads, 2, "one failed read, then one read for every later render");
	assert.equal(mod.peekCatalog("pt-PT"), first, "the HTML render finds it without a request");
	assert.equal(await mod.loadServerMessages("en"), (await mod.loadServerMessages("en")), "English is bundled");
	assert.equal(globalThis.assetReads, 2);
});

test("catalog store: concurrent loads share one request; reload replaces the entry", async () => {
	let loads = 0;
	const load = async () => ({ "navigation.inbox": `v${++loads}` });
	const [a, b] = await Promise.all([mod.loadCatalog("fr", load), mod.loadCatalog("fr", load)]);
	assert.equal(a, b);
	assert.equal(loads, 1);
	const reloaded = mod.loadCatalog("fr", load, { reload: true });
	assert.equal(mod.peekCatalog("fr"), a, "the previous catalog serves until the reload lands");
	assert.equal((await reloaded)["navigation.inbox"], "v2");
	mod.rememberCatalog("de", { "navigation.inbox": "Posteingang" });
	assert.equal(mod.peekCatalog("de")["navigation.inbox"], "Posteingang");
});

test("the favicon is the static icon unless a custom one exists, which gets a versioned URL", () => {
	assert.equal(mod.brandingIconHref(null), mod.DEFAULT_ICON_HREF);
	assert.equal(mod.brandingIconHref({ iconKey: null, updatedAt: new Date(5_000) }), "/icon-96.png");
	assert.equal(mod.brandingIconHref({ iconKey: "branding/app-icon", updatedAt: new Date(1_700_000_000_123) }), "/api/branding/icon?v=1700000000");
	assert.equal(mod.brandingIconHref({ iconKey: "branding/app-icon", updatedAt: null }), "/api/branding/icon");
});
