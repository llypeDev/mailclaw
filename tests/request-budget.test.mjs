import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

// Requests the browser no longer makes, and binary routes that answer 304/206 (plan items 6.25-6.33).
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const directory = mkdtempSync(join(root, "node_modules", "request-budget-test-"));
after(() => {
	rmSync(directory, { recursive: true, force: true });
	delete globalThis.requestBudgetTest;
});

const mocks = {
	"@/lib/push/client": "export async function hasActivePushSubscription() { return false; }",
	"@/lib/auth/client": "export async function authFetch() { throw new Error('unused'); }",
	"@/lib/auth/cookies": "export async function getCurrentUser() { return globalThis.requestBudgetTest.user; }",
	"@/lib/cloudflare": "export function getEnv() { return globalThis.requestBudgetTest.env; }",
	"@/lib/email/attachments": "export async function assessStoredAttachment(...args) { globalThis.requestBudgetTest.riskChecks += 1; return globalThis.requestBudgetTest.risk; }",
	"./lookup": "export async function findReadableAttachment() { return globalThis.requestBudgetTest.attachment; }",
};

await build({
	stdin: {
		contents: [
			`export { etagMatches, parseByteRange, formatContentRange, ifRangeAllows } from "./src/lib/http/object-cache.ts";`,
			`export { createCachedHostResolver } from "./src/lib/remote-images/host-cache.ts";`,
			`export { getRouteTemplateKey, claimRouteTemplatePrefetch } from "./src/lib/navigation/prefetch-utils.ts";`,
			`export { getSendStatusPollDelay } from "./src/components/compose/send-notice-utils.ts";`,
			`export { hasUnfinishedAgentJob } from "./src/components/agent/job-polling-utils.ts";`,
			`export { getHeartbeatMessage, createRevisionCheckMessage, REALTIME_KEEPALIVE_MESSAGE, REALTIME_REVISION_CHECK_INTERVAL_MS } from "./src/hooks/message-realtime-utils.ts";`,
			`export { GET as getAttachment } from "./src/app/api/messages/[messageId]/attachments/[attachmentId]/route.ts";`,
			`export { streamDriveFile } from "./src/lib/drive/content.ts";`,
		].join("\n"),
		resolveDir: root,
		sourcefile: "request-budget-entry.ts",
		loader: "ts",
	},
	outfile: join(directory, "entry.mjs"),
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node22",
	packages: "external",
	alias: { "@": join(root, "src") },
	logLevel: "silent",
	plugins: [{ name: "request-budget-mocks", setup(builder) {
		builder.onResolve({ filter: /^(@\/lib\/(push\/client|auth\/client|auth\/cookies|cloudflare|email\/attachments)|\.\/lookup)$/ }, ({ path }) => ({ path, namespace: "mock" }));
		builder.onLoad({ filter: /.*/, namespace: "mock" }, ({ path }) => ({ contents: mocks[path], loader: "js" }));
	} }],
});
const lib = await import(pathToFileURL(join(directory, "entry.mjs")).href);

test("If-None-Match matches lists, weak tags and *", () => {
	assert.equal(lib.etagMatches('"a"', '"a"'), true);
	assert.equal(lib.etagMatches('W/"a"', '"a"'), true);
	assert.equal(lib.etagMatches('"x", "a"', '"a"'), true);
	assert.equal(lib.etagMatches("*", '"a"'), true);
	assert.equal(lib.etagMatches('"b"', '"a"'), false);
	assert.equal(lib.etagMatches(null, '"a"'), false);
	assert.equal(lib.etagMatches('"a"', ""), false);
});

test("a single byte range resolves against the size; others are ignored or unsatisfiable", () => {
	assert.deepEqual(lib.parseByteRange("bytes=0-99", 1000), { offset: 0, length: 100 });
	assert.deepEqual(lib.parseByteRange("bytes=900-", 1000), { offset: 900, length: 100 });
	assert.deepEqual(lib.parseByteRange("bytes=900-5000", 1000), { offset: 900, length: 100 });
	assert.deepEqual(lib.parseByteRange("bytes=-100", 1000), { offset: 900, length: 100 });
	assert.deepEqual(lib.parseByteRange("bytes=-5000", 1000), { offset: 0, length: 1000 });
	assert.equal(lib.parseByteRange("bytes=1000-", 1000), "unsatisfiable");
	assert.equal(lib.parseByteRange("bytes=-0", 1000), "unsatisfiable");
	for (const header of [null, "", "bytes=0-1,5-6", "items=0-1", "bytes=5-1", "bytes=-", "bytes=a-b"]) {
		assert.equal(lib.parseByteRange(header, 1000), null, String(header));
	}
	assert.equal(lib.formatContentRange({ offset: 900, length: 100 }, 1000), "bytes 900-999/1000");
});

test("If-Range only lets a range through for the current strong tag", () => {
	assert.equal(lib.ifRangeAllows(null, '"a"'), true);
	assert.equal(lib.ifRangeAllows('"a"', '"a"'), true);
	assert.equal(lib.ifRangeAllows('"b"', '"a"'), false);
	assert.equal(lib.ifRangeAllows('W/"a"', '"a"'), false);
	assert.equal(lib.ifRangeAllows("Wed, 21 Oct 2015 07:28:00 GMT", '"a"'), false);
});

test("the remote image host resolver shares lookups per host, expires them and never keeps failures", async () => {
	let now = 0;
	const calls = [];
	let fail = false;
	const resolve = lib.createCachedHostResolver(async (host) => {
		calls.push(host);
		if (fail) throw new Error("dns down");
		return ["93.184.216.34"];
	}, { ttlMs: 1000, maxEntries: 2, now: () => now });
	const results = await Promise.all(Array.from({ length: 30 }, () => resolve("cdn.example")));
	assert.equal(calls.length, 1);
	assert.deepEqual(results[29], ["93.184.216.34"]);
	now = 999;
	await resolve("CDN.example");
	assert.equal(calls.length, 1);
	now = 1000;
	await resolve("cdn.example");
	assert.equal(calls.length, 2);

	fail = true;
	await assert.rejects(resolve("down.example"));
	fail = false;
	assert.deepEqual(await resolve("down.example"), ["93.184.216.34"]);
	assert.equal(calls.filter((host) => host === "down.example").length, 2);

	await resolve("third.example");
	await resolve("cdn.example");
	assert.equal(calls.at(-1), "cdn.example", "the oldest entry is evicted past maxEntries");
});

test("a message route is prefetched once per folder within the TTL", () => {
	assert.equal(lib.getRouteTemplateKey("/inbox/msg_1"), "/inbox");
	assert.equal(lib.getRouteTemplateKey("/folders/f1/msg_1?x=1#y"), "/folders/f1");
	assert.equal(lib.getRouteTemplateKey("/inbox/msg_1/"), "/inbox");
	const registry = new Map();
	assert.equal(lib.claimRouteTemplatePrefetch(registry, "/inbox", 0, 1000), true);
	assert.equal(lib.claimRouteTemplatePrefetch(registry, "/inbox", 999, 1000), false);
	assert.equal(lib.claimRouteTemplatePrefetch(registry, "/sent", 999, 1000), true);
	assert.equal(lib.claimRouteTemplatePrefetch(registry, "/inbox", 1000, 1000), true);
});

test("delivery checks back off to at most 8 over the 30 s wait", () => {
	assert.deepEqual([0, 1, 2, 3, 10].map(lib.getSendStatusPollDelay), [1000, 2000, 4000, 4000, 4000]);
	let elapsed = 0;
	let checks = 0;
	for (let attempt = 0; ; attempt += 1) {
		elapsed += lib.getSendStatusPollDelay(attempt);
		if (elapsed > 30_000) break;
		checks += 1;
	}
	assert.equal(checks, 8);
});

test("the assistant panel polls only while a job is unfinished", () => {
	assert.equal(lib.hasUnfinishedAgentJob([]), false);
	assert.equal(lib.hasUnfinishedAgentJob([{ status: "completed" }, { status: "failed" }, { status: "skipped" }]), false);
	assert.equal(lib.hasUnfinishedAgentJob([{ status: "completed" }, { status: "pending" }]), true);
	assert.equal(lib.hasUnfinishedAgentJob([{ status: "running" }]), true);
});

test("heartbeats are bare keep-alives except a periodic revision check in a visible tab", () => {
	const interval = lib.REALTIME_REVISION_CHECK_INTERVAL_MS;
	assert.equal(lib.REALTIME_KEEPALIVE_MESSAGE, "ping");
	assert.equal(lib.getHeartbeatMessage({ now: interval - 1, lastRevisionCheckAt: 0, visible: true, revision: "r1" }), "ping");
	assert.equal(lib.getHeartbeatMessage({ now: interval * 10, lastRevisionCheckAt: 0, visible: false, revision: "r1" }), "ping");
	assert.deepEqual(JSON.parse(lib.getHeartbeatMessage({ now: interval, lastRevisionCheckAt: 0, visible: true, revision: "r1" })), { type: "ping", revision: "r1" });
	assert.deepEqual(JSON.parse(lib.createRevisionCheckMessage(null)), { type: "ping", revision: null });
});

function attachmentState({ attachment = { filename: "photo.png", contentType: "image/png", size: 1000, r2Key: "att/1", disposition: "inline" }, risk = { level: "ok", reasons: [] }, etag = '"etag-1"' } = {}) {
	const calls = { get: [], head: [] };
	const object = (range) => ({
		httpEtag: etag,
		body: new Blob([new Uint8Array(range?.length ?? attachment.size)]).stream(),
		writeHttpMetadata(headers) { headers.set("Content-Type", "text/html"); headers.set("Cache-Control", "public, max-age=1"); },
	});
	globalThis.requestBudgetTest = {
		user: { id: "u1" },
		attachment,
		risk,
		riskChecks: 0,
		env: { BUCKET: {
			async get(key, options) { calls.get.push(options ?? null); return object(options?.range); },
			async head(key) { calls.head.push(key); return { httpEtag: etag }; },
		} },
	};
	return calls;
}
const attachmentParams = { params: Promise.resolve({ messageId: "m1", attachmentId: "a1" }) };
const attachmentRequest = (query = "", headers = {}) => new Request(`https://mail.test/api/messages/m1/attachments/a1${query}`, { headers });

test("the attachment risk check never opens the object", async () => {
	const calls = attachmentState({ attachment: { filename: "setup.exe", contentType: "application/octet-stream", size: 10, r2Key: "k", disposition: "attachment" }, risk: { level: "blocked", reasons: ["x"] } });
	const response = await lib.getAttachment(attachmentRequest("?risk=1"), attachmentParams);
	assert.equal(response.status, 200);
	assert.deepEqual(await response.json(), { level: "blocked", reasons: ["x"] });
	assert.equal(calls.get.length + calls.head.length, 0);
	const flagged = await lib.getAttachment(attachmentRequest("?download=1"), attachmentParams);
	assert.equal(flagged.status, 409);
	assert.equal(calls.get.length + calls.head.length, 0);
});

test("an inline attachment skips the risk check and revalidates with head() only", async () => {
	const calls = attachmentState();
	const response = await lib.getAttachment(attachmentRequest("", { "If-None-Match": '"etag-1"' }), attachmentParams);
	assert.equal(response.status, 304);
	assert.equal(response.headers.get("ETag"), '"etag-1"');
	assert.equal(response.headers.get("Cache-Control"), "private, max-age=604800, immutable");
	assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
	assert.match(response.headers.get("Content-Security-Policy"), /sandbox/);
	assert.equal(calls.get.length, 0);
	assert.equal(calls.head.length, 1);
	assert.equal(globalThis.requestBudgetTest.riskChecks, 0);
});

test("a full attachment response carries ETag, Accept-Ranges and our own headers", async () => {
	const calls = attachmentState();
	const response = await lib.getAttachment(attachmentRequest(), attachmentParams);
	assert.equal(response.status, 200);
	assert.equal(response.headers.get("Content-Type"), "image/png");
	assert.equal(response.headers.get("Cache-Control"), "private, max-age=604800, immutable");
	assert.equal(response.headers.get("ETag"), '"etag-1"');
	assert.equal(response.headers.get("Accept-Ranges"), "bytes");
	assert.equal(response.headers.get("Content-Length"), "1000");
	assert.match(response.headers.get("Content-Disposition"), /^inline;/);
	assert.deepEqual(calls.get, [null]);
	assert.equal((await response.arrayBuffer()).byteLength, 1000);
});

test("attachment ranges answer 206 or 416, and a stale If-Range gets the whole file", async () => {
	let calls = attachmentState();
	let response = await lib.getAttachment(attachmentRequest("", { Range: "bytes=100-199" }), attachmentParams);
	assert.equal(response.status, 206);
	assert.equal(response.headers.get("Content-Range"), "bytes 100-199/1000");
	assert.equal(response.headers.get("Content-Length"), "100");
	assert.deepEqual(calls.get, [{ range: { offset: 100, length: 100 } }]);
	assert.equal((await response.arrayBuffer()).byteLength, 100);

	calls = attachmentState();
	response = await lib.getAttachment(attachmentRequest("", { Range: "bytes=5000-" }), attachmentParams);
	assert.equal(response.status, 416);
	assert.equal(response.headers.get("Content-Range"), "bytes */1000");
	assert.equal(calls.get.length, 0);

	calls = attachmentState();
	response = await lib.getAttachment(attachmentRequest("", { Range: "bytes=0-9", "If-Range": '"old"' }), attachmentParams);
	assert.equal(response.status, 200);
	assert.equal(response.headers.get("Content-Length"), "1000");
	assert.equal(calls.get.length, 2);
});

const driveItem = { kind: "file", id: "d1", name: "notes.txt", contentType: "text/plain", size: 10, updatedAt: new Date(1_700_000_000_000), ownerId: "u1", r2Key: "drive/d1" };
const driveEtag = `"d1-${driveItem.updatedAt.getTime().toString(36)}-${(10).toString(36)}"`;

test("a Drive file revalidates from the database row without touching the bucket", async () => {
	const touched = [];
	const env = { BUCKET: { async get(key) { touched.push(["get", key]); return { body: new Blob(["0123456789"]).stream() }; }, async head(key) { touched.push(["head", key]); return {}; } } };
	const notModified = await lib.streamDriveFile(env, new Request("https://mail.test/f", { headers: { "If-None-Match": driveEtag } }), driveItem, false);
	assert.equal(notModified.status, 304);
	assert.equal(notModified.headers.get("Cache-Control"), "private, no-cache");
	assert.equal(notModified.headers.get("X-Content-Type-Options"), "nosniff");
	assert.equal(touched.length, 0);

	const head = await lib.streamDriveFile(env, new Request("https://mail.test/f", { method: "HEAD" }), driveItem, false);
	assert.equal(head.status, 200);
	assert.equal(head.headers.get("Content-Length"), "10");
	assert.deepEqual(touched, [["head", "drive/d1"]]);

	const full = await lib.streamDriveFile(env, new Request("https://mail.test/f"), driveItem, false);
	assert.equal(full.status, 200);
	assert.equal(full.headers.get("ETag"), driveEtag);
	assert.equal(await full.text(), "0123456789");
});
