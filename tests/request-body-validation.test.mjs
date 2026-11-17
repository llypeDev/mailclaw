import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

// Malformed or mistyped JSON bodies are client errors (400), not crashes (500).
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(root, "tests", ".tmp-request-validation-"));
after(() => {
	rmSync(outDir, { recursive: true, force: true });
	delete globalThis.requestValidationFixture;
});

const mocks = {
	"@/lib/cloudflare": "export function getEnv() { return globalThis.requestValidationFixture.env; }",
	"@/lib/auth/cookies": "export async function getCurrentUser() { return globalThis.requestValidationFixture.user; }",
	"@/lib/calendar/api-auth": `
		export async function authorizeCalendarRequest() { return { user: globalThis.requestValidationFixture.user, key: null, error: null }; }
		export function calendarKeyCanSendInvitations() { return true; }
	`,
	"@/lib/email/send": "export async function sendEmail() { throw new Error('no mail in tests'); }",
};
await build({
	entryPoints: {
		bulk: join(root, "src/app/api/messages/bulk/route.ts"),
		event: join(root, "src/app/api/calendar/events/[eventId]/route.ts"),
		keyAuthUtils: join(root, "src/lib/api/key-auth-utils.ts"),
		totalUtils: join(root, "src/hooks/message-total-utils.ts"),
	},
	outdir: outDir,
	outExtension: { ".js": ".mjs" },
	bundle: true,
	platform: "node",
	format: "esm",
	packages: "external",
	tsconfig: join(root, "tsconfig.json"),
	logLevel: "silent",
	plugins: [{
		name: "request-validation-fixtures",
		setup(builder) {
			builder.onResolve({ filter: /^next\/server$/ }, () => ({ path: "next/server.js", external: true }));
			builder.onResolve({ filter: /^@\/lib\// }, (args) => args.path in mocks ? { path: args.path, namespace: "mock" } : undefined);
			builder.onLoad({ filter: /.*/, namespace: "mock" }, (args) => ({ contents: mocks[args.path], loader: "js" }));
		},
	}],
});
const load = (name) => import(pathToFileURL(join(outDir, `${name}.mjs`)).href);
const bulk = await load("bulk");
const event = await load("event");
const { isLastUsedStale } = await load("keyAuthUtils");
const { getMessageTotalKey, hasNextMessagePage, isReadFilteredTotalKey } = await load("totalUtils");

// No query may run for a rejected body, so the database is a tripwire.
globalThis.requestValidationFixture = {
	user: { id: "u1", email: "kevin@example.com", role: "admin", timeZone: "UTC" },
	env: { DB: new Proxy({}, { get() { throw new Error("the database must not be reached"); } }) },
};

const send = (method, body, contentType = "application/json") => new Request("https://mail.example/api", {
	method,
	headers: { "Content-Type": contentType },
	body,
});
const params = { params: Promise.resolve({ eventId: "evt_1" }) };

test("the bulk route answers 400 to malformed or mistyped bodies", async () => {
	for (const body of ["{", "[1,2", JSON.stringify({ messageIds: "m1", action: "read" }), JSON.stringify({ messageIds: [1, 2], action: "read" }), JSON.stringify({ messageIds: ["m1"], action: 5 }), "null"]) {
		const response = await bulk.POST(send("POST", body));
		assert.equal(response.status, 400, body);
		assert.ok((await response.json()).error);
	}
	const unknown = await bulk.POST(send("POST", JSON.stringify({ messageIds: ["m1"], action: "explode" })));
	assert.equal(unknown.status, 400);
	assert.equal((await unknown.json()).error, "Invalid bulk message action");
});

test("the calendar event route answers 400 to malformed or mistyped bodies", async () => {
	for (const body of ["{", JSON.stringify({ title: 5, startsAt: "2026-01-01T10:00:00Z", endsAt: "2026-01-01T11:00:00Z" }), JSON.stringify({ title: "x", attendees: "a@b.c" }), JSON.stringify({ title: "x", startsAt: {} })]) {
		const response = await event.PATCH(send("PATCH", body), params);
		assert.equal(response.status, 400, body);
	}
	const missingTimes = await event.PATCH(send("PATCH", JSON.stringify({ title: "Standup" })), params);
	assert.equal(missingTimes.status, 400);
	assert.equal((await missingTimes.json()).error, "Enter a title and valid event times");
	const badDelete = await event.DELETE(send("DELETE", JSON.stringify({ effectiveFrom: { at: 1 } })), params);
	assert.equal(badDelete.status, 400);
});

test("the API key's last-used time is written at most once per interval", () => {
	const staleBefore = new Date("2026-01-01T00:01:00Z");
	assert.equal(isLastUsedStale(null, staleBefore), true);
	assert.equal(isLastUsedStale(new Date("2026-01-01T00:00:00Z"), staleBefore), true);
	assert.equal(isLastUsedStale(new Date("2026-01-01T00:01:30Z"), staleBefore), false);
});

test("list totals are kept per view, not per page", () => {
	const page = (query) => new URLSearchParams(query);
	assert.equal(getMessageTotalKey(page("status=received&limit=50&offset=100&mailboxId=m")), getMessageTotalKey(page("mailboxId=m&status=received")));
	assert.notEqual(getMessageTotalKey(page("status=received&group=thread")), getMessageTotalKey(page("status=received")));
	assert.equal(isReadFilteredTotalKey(getMessageTotalKey(page("status=received&read=unread"))), true);
	assert.equal(isReadFilteredTotalKey(getMessageTotalKey(page("status=received"))), false);
	assert.equal(hasNextMessagePage({ hasMore: true, total: null }, 0, 50), true);
	assert.equal(hasNextMessagePage({ hasMore: false, total: 999 }, 0, 50), false);
	assert.equal(hasNextMessagePage({ total: 120 }, 50, 50), true, "older cached responses without hasMore");
	assert.equal(hasNextMessagePage({ total: 100 }, 50, 50), false);
});
