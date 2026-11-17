import assert from "node:assert/strict";
import test, { after } from "node:test";
import { loadAppWithSqlite, seconds } from "./helpers/app-sqlite.mjs";

// handleJmapRequest (src/lib/jmap/handler.ts) end to end against a migrated SQLite database: path
// ownership, CORS, API-key authentication (Bearer and Basic) and the jmap scope, the Session object
// (session.ts), request-level problems, and an API request running Mailbox/get and Email/query over
// seeded mail, with unknown methods and unsupported header filters answered as method errors.
const app = await loadAppWithSqlite({
	name: "jmap-handler",
	exports: [
		`export { handleJmapRequest } from "./src/lib/jmap/handler.ts";`,
		`export { hashApiKey } from "./src/lib/api-keys.ts";`,
		`export { clearApiKeyVerificationCache } from "./src/lib/api/find-api-key.ts";`,
		`export { encodeMailboxRef } from "./src/lib/jmap/ids.ts";`,
		`export * from "./src/lib/jmap/constants.ts";`,
	],
});
after(app.dispose);
const lib = app.lib;

const ORIGIN = "https://mail.example.com";
const KEY = "ep_jmap-test-key";
const NO_SCOPE_KEY = "ep_contacts-only-key";
const USING = [lib.CAPABILITY_CORE, lib.CAPABILITY_MAIL];

async function fixture(t, { appUrl } = {}) {
	lib.clearApiKeyVerificationCache();
	const database = await app.openDatabase(t);
	const sql = database.db;
	const env = { DB: database, ...(appUrl ? { APP_URL: appUrl } : {}) };
	const now = seconds(new Date("2026-11-16T12:00:00Z"));
	sql.prepare("INSERT INTO users (id, email, name, password_hash, created_at) VALUES ('u1', 'kevin@example.com', 'Kevin', 'x', ?)").run(now);
	sql.prepare("INSERT INTO users (id, email, name, password_hash, created_at) VALUES ('u2', 'bea@example.com', 'Bea', 'x', ?)").run(now);
	sql.prepare("INSERT INTO domains (id, user_id, hostname, zone_id, created_at) VALUES ('d1', 'u1', 'example.com', 'zone', ?)").run(now);
	sql.prepare("INSERT INTO mailboxes (id, user_id, domain_id, local_part, created_at) VALUES ('mb1', 'u1', 'd1', 'kevin', ?)").run(now);
	sql.prepare("INSERT INTO mailboxes (id, user_id, domain_id, local_part, created_at) VALUES ('mb2', 'u2', 'd1', 'bea', ?)").run(now);
	const addKey = async (id, userId, secret, scopes) => {
		const sha = await lib.hashApiKey(secret);
		sql.prepare("INSERT INTO api_keys (id, kind, user_id, name, prefix, key_hash, key_sha256, scopes, created_at) VALUES (?, 'mcp', ?, ?, ?, ?, ?, ?, ?)")
			.run(id, userId, id, secret.slice(0, 8), sha, sha, JSON.stringify(scopes), now);
	};
	await addKey("k1", "u1", KEY, ["jmap"]);
	await addKey("k2", "u1", NO_SCOPE_KEY, ["contacts"]);

	const addMessage = (id, mailboxId, { status = "received", read = 0, subject = id, providerMessageId = `<${id}@example.org>`, createdAt, userId = mailboxId === "mb1" ? "u1" : "u2" } = {}) => {
		sql.prepare(
			"INSERT INTO messages (id, user_id, mailbox_id, direction, provider_message_id, from_addr, to_addr, subject, text_body, status, read, created_at) VALUES (?, ?, ?, ?, ?, 'Anna <anna@example.org>', 'kevin@example.com', ?, 'body', ?, ?, ?)",
		).run(id, userId, mailboxId, status === "sent" ? "outbound" : "inbound", providerMessageId, subject, status, read, createdAt);
	};
	addMessage("m1", "mb1", { createdAt: now - 300 });
	addMessage("m2", "mb1", { createdAt: now - 200, read: 1 });
	addMessage("m3", "mb1", { createdAt: now - 100 });
	addMessage("s1", "mb1", { status: "sent", createdAt: now - 50, providerMessageId: "sent-id@example.com" });
	addMessage("theirs", "mb2", { createdAt: now });
	return { sql, env };
}

const request = (path, { method = "GET", key = KEY, basic = false, body, headers = {} } = {}) => new Request(`${ORIGIN}${path}`, {
	method,
	headers: {
		...(key ? { Authorization: basic ? `Basic ${btoa(`anyone:${key}`)}` : `Bearer ${key}` } : {}),
		...(body !== undefined ? { "Content-Type": "application/json" } : {}),
		...headers,
	},
	body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
});

const api = async (env, methodCalls, using = USING) => {
	const response = await lib.handleJmapRequest(request("/jmap/api", { method: "POST", body: { using, methodCalls } }), env);
	assert.equal(response.status, 200, await response.clone().text());
	return response.json();
};

test("paths outside /jmap are not handled, OPTIONS answers CORS and the well-known URL redirects", async (t) => {
	const f = await fixture(t);
	assert.equal(await lib.handleJmapRequest(request("/api/messages"), f.env), null);
	assert.equal(await lib.handleJmapRequest(request("/jmapx"), f.env), null);

	const preflight = await lib.handleJmapRequest(request("/jmap/api", { method: "OPTIONS", key: null }), f.env);
	assert.equal(preflight.status, 204);
	assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), "*");
	assert.match(preflight.headers.get("Access-Control-Allow-Headers"), /Authorization/);

	const wellKnown = await lib.handleJmapRequest(request("/.well-known/jmap", { key: null }), f.env);
	assert.equal(wellKnown.status, 301);
	assert.equal(wellKnown.headers.get("Location"), `${ORIGIN}/jmap/session`);
});

test("requests without a valid key get 401, and a key without the jmap scope gets 403", async (t) => {
	const f = await fixture(t);
	for (const [label, options] of [
		["no Authorization header", { key: null }],
		["unknown key", { key: "ep_wrong" }],
		["empty Bearer", { key: " " }],
		["Basic with an unknown password", { key: "ep_wrong", basic: true }],
		["malformed Basic", { key: null, headers: { Authorization: "Basic %%%" } }],
	]) {
		const response = await lib.handleJmapRequest(request("/jmap/session", options), f.env);
		assert.equal(response.status, 401, label);
		assert.deepEqual(await response.json(), { error: "Unauthorized" });
		assert.equal(response.headers.get("WWW-Authenticate"), 'Basic realm="Mailclaw JMAP", Bearer');
		assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
	}

	const forbidden = await lib.handleJmapRequest(request("/jmap/session", { key: NO_SCOPE_KEY }), f.env);
	assert.equal(forbidden.status, 403);
	assert.deepEqual(await forbidden.json(), { error: "This API key does not have the jmap scope" });

	f.sql.prepare("UPDATE users SET disabled = 1 WHERE id = 'u1'").run();
	assert.equal((await lib.handleJmapRequest(request("/jmap/session"), f.env)).status, 401, "a disabled user's keys stop working");
});

test("the Session object describes one account for the key's user", async (t) => {
	const f = await fixture(t);
	for (const basic of [false, true]) {
		const response = await lib.handleJmapRequest(request("/jmap/session", { basic }), f.env);
		assert.equal(response.status, 200);
		assert.equal(response.headers.get("Cache-Control"), "no-store");
		assert.match(response.headers.get("Content-Type"), /^application\/json/);
		const session = await response.json();
		assert.deepEqual(Object.keys(session.capabilities).sort(), [lib.CAPABILITY_CORE, lib.CAPABILITY_MAIL, lib.CAPABILITY_SUBMISSION].sort());
		assert.equal(session.capabilities[lib.CAPABILITY_CORE].maxCallsInRequest, lib.LIMITS.maxCallsInRequest);
		assert.equal(session.capabilities[lib.CAPABILITY_CORE].maxSizeUpload, lib.LIMITS.maxSizeUpload);
		assert.deepEqual(Object.keys(session.accounts), ["u1"]);
		assert.equal(session.accounts.u1.name, "kevin@example.com");
		assert.equal(session.accounts.u1.isPersonal, true);
		assert.equal(session.accounts.u1.accountCapabilities[lib.CAPABILITY_MAIL].mayCreateTopLevelMailbox, false);
		assert.deepEqual(session.primaryAccounts, { [lib.CAPABILITY_MAIL]: "u1", [lib.CAPABILITY_SUBMISSION]: "u1" });
		assert.equal(session.username, "kevin@example.com");
		assert.equal(session.apiUrl, `${ORIGIN}/jmap/api`);
		assert.equal(session.downloadUrl, `${ORIGIN}/jmap/download/{accountId}/{blobId}/{name}?type={type}`);
		assert.equal(session.uploadUrl, `${ORIGIN}/jmap/upload/{accountId}`);
		assert.equal(session.eventSourceUrl, `${ORIGIN}/jmap/eventsource?types={types}&closeafter={closeafter}&ping={ping}`);
		assert.equal(typeof session.state, "string");
		assert.ok(session.state.length > 0);
	}
	const lastUsed = f.sql.prepare("SELECT last_used_at FROM api_keys WHERE id = 'k1'").get().last_used_at;
	assert.ok(lastUsed, "using a key records when it was last used");
});

test("APP_URL, when set, is the origin of every Session URL", async (t) => {
	const f = await fixture(t, { appUrl: " https://public.example.net " });
	const session = await (await lib.handleJmapRequest(request("/jmap/session"), f.env)).json();
	assert.equal(session.apiUrl, "https://public.example.net/jmap/api");
});

test("Mailbox/get and Email/query answer over the account's own mail", async (t) => {
	const f = await fixture(t);
	const inbox = lib.encodeMailboxRef({ kind: "role", mailboxId: "mb1", role: "inbox" });
	const sent = lib.encodeMailboxRef({ kind: "role", mailboxId: "mb1", role: "sent" });
	const response = await api(f.env, [
		["Mailbox/get", { accountId: "u1", ids: ["mb1", inbox, sent, "mb2", "nonsense"], properties: ["name", "role", "parentId", "totalEmails", "unreadEmails"] }, "a"],
		["Email/query", { accountId: "u1", filter: { inMailbox: inbox }, sort: [{ property: "receivedAt", isAscending: false }], calculateTotal: true }, "b"],
		["Email/query", { filter: { inMailbox: inbox }, sort: [{ property: "receivedAt", isAscending: true }], position: 1, limit: 1 }, "c"],
		["Email/query", {}, "d"],
	]);
	const [[getName, mailboxes, getId], [queryName, query, queryId], [, page], [, everything]] = response.methodResponses;

	assert.deepEqual([getName, getId, queryName, queryId], ["Mailbox/get", "a", "Email/query", "b"]);
	assert.equal(mailboxes.accountId, "u1");
	assert.deepEqual(mailboxes.notFound, ["mb2", "nonsense"], "another user's mailbox does not exist for this account");
	// s1 is stored unread, but only inbound mail counts as unread.
	assert.deepEqual(mailboxes.list, [
		{ id: "mb1", name: "kevin@example.com", role: null, parentId: null, totalEmails: 4, unreadEmails: 2 },
		{ id: inbox, name: "Inbox", role: "inbox", parentId: "mb1", totalEmails: 3, unreadEmails: 2 },
		{ id: sent, name: "Sent", role: "sent", parentId: "mb1", totalEmails: 1, unreadEmails: 0 },
	]);

	assert.deepEqual(query.ids, ["m3", "m2", "m1"]);
	assert.equal(query.total, 3);
	assert.equal(query.position, 0);
	assert.equal(query.canCalculateChanges, false);
	assert.deepEqual(page.ids, ["m2"]);
	assert.equal(page.position, 1);
	assert.deepEqual([...everything.ids].sort(), ["m1", "m2", "m3", "s1"], "no filter means every message the account can read");
	assert.equal(response.sessionState, query.queryState);
});

test("an unknown method and an unsupported header filter fail alone, as method errors", async (t) => {
	const f = await fixture(t);
	const response = await api(f.env, [
		["Mailbox/frobnicate", {}, "a"],
		["Email/query", { filter: { header: ["X-Spam-Flag", "YES"] } }, "b"],
		["Email/query", { filter: { header: ["Message-ID", "m2@example.org"] } }, "c"],
		["Email/query", { filter: { header: ["message-id", "<sent-id@example.com>"] } }, "d"],
		["Email/query", { filter: { header: ["Subject", "x", "extra"] } }, "e"],
		["Email/query", { accountId: "u2" }, "f"],
		["Core/echo", { hello: "world" }, "g"],
	]);
	assert.deepEqual(response.methodResponses, [
		["error", { type: "unknownMethod" }, "a"],
		["error", { type: "unsupportedFilter", description: "Cannot filter on the X-Spam-Flag header" }, "b"],
		["Email/query", response.methodResponses[2][1], "c"],
		["Email/query", response.methodResponses[3][1], "d"],
		["error", { type: "invalidArguments", description: "header must be [name] or [name, value]" }, "e"],
		["error", { type: "accountNotFound" }, "f"],
		["Core/echo", { hello: "world" }, "g"],
	]);
	// Message-ID matches whether or not either side carries angle brackets.
	assert.deepEqual(response.methodResponses[2][1].ids, ["m2"]);
	assert.deepEqual(response.methodResponses[3][1].ids, ["s1"]);
});

test("request-level problems are RFC 7807 documents", async (t) => {
	const f = await fixture(t);
	const problem = async (req) => {
		const response = await lib.handleJmapRequest(req, f.env);
		assert.equal(response.headers.get("Content-Type"), "application/problem+json");
		return [response.status, await response.json()];
	};
	assert.deepEqual(await problem(request("/jmap/api", { method: "POST", body: "{not json" })), [400, { type: "urn:ietf:params:jmap:error:notJSON", status: 400, detail: "Body is not valid JSON" }]);
	assert.deepEqual((await problem(request("/jmap/api", { method: "POST", body: { using: USING } })))[1].type, "urn:ietf:params:jmap:error:notRequest");
	assert.deepEqual((await problem(request("/jmap/api", { method: "POST", body: { using: USING, methodCalls: [["Core/echo", {}]] } })))[1].type, "urn:ietf:params:jmap:error:notRequest", "a call needs a call id");
	assert.deepEqual(await problem(request("/jmap/api", { method: "POST", body: { using: ["https://example.com/vendor"], methodCalls: [] } })), [400, { type: "urn:ietf:params:jmap:error:unknownCapability", status: 400, detail: "https://example.com/vendor" }]);
	const tooMany = Array.from({ length: lib.LIMITS.maxCallsInRequest + 1 }, (_, n) => ["Core/echo", {}, `c${n}`]);
	assert.deepEqual(await problem(request("/jmap/api", { method: "POST", body: { using: USING, methodCalls: tooMany } })), [400, { type: "urn:ietf:params:jmap:error:limit", status: 400, detail: "Too many method calls", limit: "maxCallsInRequest" }]);
	assert.deepEqual(
		await problem(request("/jmap/api", { method: "POST", body: "{}", headers: { "Content-Length": String(lib.LIMITS.maxSizeRequest + 1) } })),
		[400, { type: "urn:ietf:params:jmap:error:limit", status: 400, detail: "Request too large", limit: "maxSizeRequest" }],
	);
	// An optional IETF extension a client lists without calling is accepted.
	const ok = await api(f.env, [["Core/echo", { a: 1 }, "x"]], [...USING, "urn:ietf:params:jmap:quota"]);
	assert.deepEqual(ok.methodResponses, [["Core/echo", { a: 1 }, "x"]]);
});

test("unknown JMAP paths and another account's download or upload are not found", async (t) => {
	const f = await fixture(t);
	let response = await lib.handleJmapRequest(request("/jmap/nothing-here"), f.env);
	assert.equal(response.status, 404);
	assert.deepEqual(await response.json(), { error: "Not found" });
	response = await lib.handleJmapRequest(request("/jmap/session", { method: "POST", body: {} }), f.env);
	assert.equal(response.status, 404, "the session is GET only");
	response = await lib.handleJmapRequest(request("/jmap/download/u2/msg~theirs/mail.eml"), f.env);
	assert.equal(response.status, 404);
	response = await lib.handleJmapRequest(request("/jmap/download/u1/msg~theirs/mail.eml"), f.env);
	assert.equal(response.status, 404, "a blob in a mailbox the account cannot read");
	response = await lib.handleJmapRequest(request("/jmap/upload/u2", { method: "POST", body: "x" }), f.env);
	assert.equal(response.status, 404);
	assert.equal((await response.json()).type, "urn:ietf:params:jmap:error:accountNotFound");
});
