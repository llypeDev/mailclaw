import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

// Bounded resources in the self-hosted runtime (queue concurrency, file bucket
// listing and reads, rate limiter and statement cache eviction), the SMTP
// per-recipient bookkeeping, and the shared fetch deadline / body limit helpers.

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(root, "tests", ".tmp-node-runtime-bounds-"));
after(() => rmSync(outDir, { recursive: true, force: true }));

await build({
	stdin: {
		contents: [
			`export { InProcessQueue } from "./server/runtime/queue";`,
			`export { FileBucket } from "./server/runtime/file-bucket";`,
			`export { openRateLimiter } from "./server/runtime/misc";`,
			`export { cachedStatement, SqliteDatabase } from "./server/runtime/sqlite-database";`,
			`export { applyMigrations } from "./server/runtime/migrate";`,
			`export { guardRequest, rejectCrossSiteNodeRequest } from "./server/runtime/http-guard";`,
			`export * from "./server/runtime/smtp-utils";`,
			`export * from "./src/lib/http/fetch-timeout";`,
			`export { readBodyWithLimit } from "./src/lib/http/limited-body";`,
			`export * from "./src/lib/email/replay-markers";`,
			`export { getCloudflareAuthHint } from "./src/lib/cloudflare-api-utils";`,
		].join("\n"),
		resolveDir: root,
		loader: "ts",
	},
	outfile: join(outDir, "entry.mjs"),
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node22",
	external: ["better-sqlite3"],
	logLevel: "silent",
	alias: { "@": join(root, "src") },
});

const lib = await import(pathToFileURL(join(outDir, "entry.mjs")).href);
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

test("the in-process queue runs at most `concurrency` jobs at once, in order", async () => {
	const queue = new lib.InProcessQueue("test", { concurrency: 2 });
	let running = 0;
	let peak = 0;
	const started = [];
	const releases = [];
	queue.setConsumer(async (body) => {
		started.push(body);
		running += 1;
		peak = Math.max(peak, running);
		await new Promise((resolve) => releases.push(resolve));
		running -= 1;
	});
	for (let index = 0; index < 5; index += 1) await queue.send(index);
	await tick();
	assert.deepEqual(started, [0, 1]);
	assert.equal((await queue.metrics()).backlogCount, 5);
	while (started.length < 5 || releases.length) {
		releases.shift()?.();
		await tick();
	}
	assert.deepEqual(started, [0, 1, 2, 3, 4]);
	assert.equal(peak, 2);
	assert.equal((await queue.metrics()).backlogCount, 0);
	queue.stop();
});

test("a failed job is retried after the delay and a slot frees for the next", async () => {
	const queue = new lib.InProcessQueue("retry", { concurrency: 1, maxRetries: 1, retryDelayMs: 1 });
	const seen = [];
	queue.setConsumer(async (body) => {
		seen.push(body);
		if (body === "bad") throw new Error("boom");
	});
	const error = console.error;
	console.error = () => {};
	try {
		await queue.send("bad");
		await queue.send("good");
		for (let index = 0; index < 10 && seen.length < 3; index += 1) await tick();
	} finally {
		console.error = error;
		queue.stop();
	}
	assert.deepEqual(seen, ["bad", "good", "bad"]);
});

test("without an override the queue uses the Workers retry count and backoff", async () => {
	const delays = [];
	const realSetTimeout = globalThis.setTimeout;
	globalThis.setTimeout = (callback, delay) => {
		delays.push(delay);
		return realSetTimeout(callback, 0);
	};
	const error = console.error;
	console.error = () => {};
	const queue = new lib.InProcessQueue("backoff", { kind: "agent" });
	let calls = 0;
	try {
		queue.setConsumer(async () => { calls += 1; throw new Error("always"); });
		await queue.send("job");
		for (let index = 0; index < 20 && calls < 4; index += 1) await new Promise((resolve) => realSetTimeout(resolve, 5));
	} finally {
		globalThis.setTimeout = realSetTimeout;
		console.error = error;
		queue.stop();
	}
	// The agent queue retries 3 times: delivery 1 is immediate, then 10 s, 30 s, 90 s.
	assert.equal(calls, 4);
	assert.deepEqual(delays, [0, 10_000, 30_000, 90_000]);
});

test("jobs sent before a consumer exists wait for it", async () => {
	const queue = new lib.InProcessQueue("late");
	await queue.send("early");
	await tick();
	const seen = [];
	queue.setConsumer(async (body) => { seen.push(body); });
	await tick();
	assert.deepEqual(seen, ["early"]);
	queue.stop();
});

test("file bucket lists in key order across directories, page by page", async () => {
	const bucket = new lib.FileBucket(join(outDir, "bucket-list"));
	const keys = ["a-c", "a/b", "a/z/1", "a.txt", "a0", "b/x", "inbound/2.eml", "inbound/1.eml", "inbound/10.eml", "other/inbound/1.eml"];
	for (const key of keys) await bucket.put(key, "x");
	const all = [];
	let cursor;
	do {
		const page = await bucket.list({ cursor, limit: 3 });
		all.push(...page.objects.map((object) => object.key));
		assert.ok(page.objects.length <= 3);
		cursor = page.truncated ? page.cursor : undefined;
	} while (cursor);
	assert.deepEqual(all, [...keys].sort());

	const inbound = await bucket.list({ prefix: "inbound/" });
	assert.deepEqual(inbound.objects.map((object) => object.key), ["inbound/1.eml", "inbound/10.eml", "inbound/2.eml"]);
	assert.equal(inbound.truncated, false);
	const partial = await bucket.list({ prefix: "a/z" });
	assert.deepEqual(partial.objects.map((object) => object.key), ["a/z/1"]);
	const afterCursor = await bucket.list({ prefix: "a", cursor: "a/b" });
	// "a.txt" sorts before "a/b" ('.' < '/'), so it is not after the cursor.
	assert.deepEqual(afterCursor.objects.map((object) => object.key), ["a/z/1", "a0"]);
	assert.deepEqual((await bucket.list({ prefix: "missing/" })).objects, []);
});

test("file bucket skips sidecars, partial writes and multipart staging", async () => {
	const directory = join(outDir, "bucket-hidden");
	const bucket = new lib.FileBucket(directory);
	await bucket.put("kept.txt", "x");
	writeFileSync(join(directory, "kept.txt.0123abcd-0123-4567-89ab-0123456789ab.partial"), "half");
	await bucket.createMultipartUpload("big.bin");
	assert.deepEqual((await bucket.list()).objects.map((object) => object.key), ["kept.txt"]);
});

test("a ranged read returns only the requested bytes", async () => {
	const bucket = new lib.FileBucket(join(outDir, "bucket-range"));
	await bucket.put("blob", "0123456789");
	const middle = await bucket.get("blob", { range: { offset: 2, length: 4 } });
	assert.equal(Buffer.from(await middle.arrayBuffer()).toString(), "2345");
	const suffix = await bucket.get("blob", { range: { suffix: 3 } });
	assert.equal(await suffix.text(), "789");
	const past = await bucket.get("blob", { range: { offset: 8, length: 100 } });
	assert.equal(await past.text(), "89");
	assert.equal(await (await bucket.get("blob")).text(), "0123456789");
});

test("a streamed put lands whole on disk and reports its size", async () => {
	const directory = join(outDir, "bucket-stream");
	const bucket = new lib.FileBucket(directory);
	const parts = ["hello ", "streamed ", "world"];
	const stream = new ReadableStream({ start(controller) { for (const part of parts) controller.enqueue(new TextEncoder().encode(part)); controller.close(); } });
	const stored = await bucket.put("dir/stream.txt", stream, { customMetadata: { from: "a@b" } });
	assert.equal(stored.size, 20);
	const object = await bucket.get("dir/stream.txt");
	assert.equal(await object.text(), "hello streamed world");
	assert.equal(object.customMetadata.from, "a@b");
	assert.equal((await bucket.put("blob.txt", new Blob(["abc"]))).size, 3);
	assert.deepEqual(readdirSync(join(directory, "dir")).sort(), ["stream.txt", "stream.txt.meta.json"]);
});

test("the rate limiter forgets expired windows", async () => {
	let now = 0;
	const limiter = lib.openRateLimiter(2, 60, () => now);
	for (let index = 0; index < 100; index += 1) assert.equal((await limiter.limit({ key: `ip-${index}` })).success, true);
	assert.equal(limiter.size(), 100);
	assert.equal((await limiter.limit({ key: "ip-1" })).success, true);
	assert.equal((await limiter.limit({ key: "ip-1" })).success, false);
	now = 61_000;
	assert.equal((await limiter.limit({ key: "fresh" })).success, true);
	assert.equal(limiter.size(), 1);
});

test("the statement cache keeps the most recently used entries", () => {
	const cache = new Map();
	let prepared = 0;
	const get = (sql) => lib.cachedStatement(cache, sql, () => ({ sql, id: ++prepared }), 2);
	get("a");
	get("b");
	assert.equal(get("a").id, 1);
	get("c");
	assert.deepEqual([...cache.keys()], ["a", "c"]);
	assert.equal(get("b").id, 4);
});

test("SMTP DATA replies combine per-recipient outcomes", () => {
	const delivered = (recipient) => ({ recipient, outcome: "delivered" });
	const rejected = (recipient, reason = "blocked") => ({ recipient, outcome: "rejected", reason });
	const failed = (recipient) => ({ recipient, outcome: "failed" });
	assert.deepEqual(lib.smtpDataReply([delivered("a"), delivered("b")]), { code: 250 });
	assert.deepEqual(lib.smtpDataReply([delivered("a"), rejected("b")]), { code: 250 });
	assert.deepEqual(lib.smtpDataReply([rejected("a", "first"), rejected("b")]), { code: 550, message: "first" });
	assert.equal(lib.smtpDataReply([delivered("a"), failed("b")]).code, 451);
	assert.equal(lib.smtpDataReply([rejected("a"), failed("b")]).code, 451);
});

test("a retried DATA skips recipients and forwards already finished", async () => {
	const completed = new lib.CompletedWork();
	const fingerprint = lib.messageFingerprint(Buffer.from("raw"), "Sender@Example.com");
	assert.equal(fingerprint, lib.messageFingerprint(Buffer.from("raw"), "sender@example.com"));
	const calls = [];
	let flaky = true;
	const forwards = [];
	const deliver = async (to) => {
		calls.push(to);
		if (to === "c@x") {
			const key = lib.forwardKey(fingerprint, to, "out@y");
			if (!completed.has(key)) {
				forwards.push(to);
				completed.add(key);
			}
			if (flaky) throw new Error("storage down");
		}
		return { rejected: to === "b@x" ? "blocked sender" : null };
	};
	const error = console.error;
	console.error = () => {};
	let first;
	try {
		first = await lib.deliverToRecipients(["a@x", "b@x", "c@x"], fingerprint, completed, deliver);
	} finally {
		console.error = error;
	}
	assert.deepEqual(first.map((item) => item.outcome), ["delivered", "rejected", "failed"]);
	assert.equal(lib.smtpDataReply(first).code, 451);

	flaky = false;
	calls.length = 0;
	const second = await lib.deliverToRecipients(["a@x", "B@x", "c@x"], fingerprint, completed, deliver);
	assert.deepEqual(calls, ["c@x"]);
	assert.deepEqual(forwards, ["c@x"]);
	assert.deepEqual(second.map((item) => item.outcome), ["delivered", "rejected", "delivered"]);
	assert.equal(second[1].reason, "blocked sender");
	assert.deepEqual(lib.smtpDataReply(second), { code: 250 });
});

test("completed work expires and stays bounded", () => {
	let now = 0;
	const completed = new lib.CompletedWork(1000, 3, () => now);
	for (const key of ["a", "b", "c", "d"]) completed.add(key);
	assert.equal(completed.size, 3);
	assert.equal(completed.has("a"), false);
	assert.equal(completed.has("d"), true);
	now = 1000;
	assert.equal(completed.has("d"), false);
});

test("forwarded copies carry the marker header on one line", () => {
	const raw = Buffer.from("Subject: hi\r\n\r\nbody");
	const forwarded = lib.withPrependedHeaders(raw, { "X-Mailclaw-Forwarded": "v1\r\nBcc: evil@x" });
	assert.equal(forwarded.toString(), "X-Mailclaw-Forwarded: v1 Bcc: evil@x\r\nSubject: hi\r\n\r\nbody");
	assert.equal(lib.withPrependedHeaders(raw, {}), raw);
	const headers = lib.parseHeaders(Buffer.from("Received: x\r\nSubject: a\r\n  folded\r\n\r\nSubject: body"));
	assert.equal(headers.subject, "a folded");
});

test("a fetch past its deadline rejects with a TimeoutError", async () => {
	const server = createServer(() => { /* never answers */ });
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address();
	try {
		const error = await fetch(`http://127.0.0.1:${port}/`, lib.withTimeout({}, 50)).then(() => null, (reason) => reason);
		assert.ok(lib.isTimeoutError(error), `expected a timeout, got ${error}`);
		assert.equal(lib.isTimeoutError(new Error("network")), false);
		const outer = new AbortController();
		const combined = lib.withTimeout({ signal: outer.signal, method: "POST" }, 60_000);
		assert.equal(combined.method, "POST");
		outer.abort();
		assert.equal(combined.signal.aborted, true);
		assert.match(lib.timeoutMessage("AWS", 30_000), /30 seconds/);
	} finally {
		server.closeAllConnections?.();
		server.close();
	}
});

test("bodies over the limit are refused from the header or while streaming", async () => {
	const request = (body, headers = {}) => new Request("https://x.test/", { method: "POST", body, headers, duplex: "half" });
	assert.equal(new TextDecoder().decode(await lib.readBodyWithLimit(request("hello"), 5)), "hello");
	assert.equal(await lib.readBodyWithLimit(request("hello!"), 5), null);
	assert.equal(await lib.readBodyWithLimit(request("hi", { "content-length": "999" }), 5), null);
	let pulled = 0;
	const endless = new ReadableStream({ pull(controller) { pulled += 1; controller.enqueue(new Uint8Array(4)); } });
	assert.equal(await lib.readBodyWithLimit(request(endless), 10), null);
	assert.ok(pulled < 10);
	assert.equal((await lib.readBodyWithLimit(new Request("https://x.test/"), 5)).byteLength, 0);
});

test("replay markers are found within the window and swept after it", async () => {
	const directory = join(outDir, "bucket-replay");
	const bucket = new lib.FileBucket(directory);
	const window = { prefix: "relay-seen", windowSeconds: 600 };
	const start = 1_700_000_000_000;
	await lib.rememberReplayMarker(bucket, window, "sig1", start);
	// A marker from before time buckets, uploaded long ago, and a recent one.
	await bucket.put("relay-seen/abc123", new Uint8Array(0));
	writeFileSync(join(directory, "relay-seen", "abc123.meta.json"), JSON.stringify({ size: 0, uploaded: new Date(start - 86_400_000).toISOString(), etag: "x" }));
	await bucket.put("relay-seen/def456", new Uint8Array(0));
	writeFileSync(join(directory, "relay-seen", "def456.meta.json"), JSON.stringify({ size: 0, uploaded: new Date(start + 1_000_000).toISOString(), etag: "x" }));
	assert.equal(await lib.hasReplayMarker(bucket, window, "sig1", start), true);
	assert.equal(await lib.hasReplayMarker(bucket, window, "sig1", start + 600_000), true);
	assert.equal(await lib.hasReplayMarker(bucket, window, "sig2", start), false);
	// A captured request verifies for at most one window after the first arrival.
	assert.equal(await lib.hasReplayMarker(bucket, window, "sig1", start + 1_200_000 + 1), false);

	// Writing in a new bucket sweeps once: sig1 is still in the previous bucket and stays.
	await lib.rememberReplayMarker(bucket, window, "sig2", start + 600_000);
	const keys = async () => (await bucket.list({ prefix: "relay-seen/" })).objects.map((object) => object.key);
	assert.deepEqual(await keys(), ["relay-seen/def456", lib.replayMarkerKey(window, "sig1", start), lib.replayMarkerKey(window, "sig2", start + 600_000)]);
	const later = start + 1_200_000;
	assert.equal(await lib.sweepReplayMarkers(bucket, window, later), 1);
	assert.deepEqual(await keys(), ["relay-seen/def456", lib.replayMarkerKey(window, "sig2", start + 600_000)]);
	assert.equal(await lib.hasReplayMarker(bucket, window, "sig2", later), true);
});

test("the 2036 hint names the Workers Paid plan first", () => {
	const hint = lib.getCloudflareAuthHint([{ code: 2036, message: "Unauthorized" }], "/zones/z/email/sending/subdomains");
	assert.match(hint, /Workers Paid/);
	assert.ok(hint.indexOf("Workers Paid") < hint.indexOf("MX records"));
});

test("the Node env forwards every string setting env.d.ts declares", () => {
	const declared = [...readFileSync(join(root, "env.d.ts"), "utf8").matchAll(/^\t([A-Z][A-Z0-9_]+)\?: string;/gm)].map((match) => match[1]);
	const source = readFileSync(join(root, "server/runtime/env.ts"), "utf8");
	const list = source.slice(source.indexOf("PASSTHROUGH_VARIABLES = ["), source.indexOf("] as const"));
	// DATABASE_* are read from process.env by the database layer; the rest are set explicitly.
	const handledElsewhere = new Set(["DATABASE_URL", "DATABASE_DRIVER", "DATABASE_AUTH_TOKEN"]);
	for (const name of declared) {
		if (handledElsewhere.has(name)) continue;
		assert.ok(list.includes(`"${name}"`) || new RegExp(`\\b${name}:`).test(source), `${name} is not forwarded on Node`);
	}
	assert.ok(declared.includes("APNS_RELAY_URL"));
});

test("Node migrations run in filename order and only once", async () => {
	const migrationsDir = join(root, "drizzle", "migrations");
	const files = readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort();
	const fresh = new lib.SqliteDatabase(join(outDir, "fresh.sqlite"));
	try {
		assert.deepEqual(await lib.applyMigrations(fresh, migrationsDir), files);
		assert.deepEqual(fresh.db.prepare("SELECT name FROM d1_migrations ORDER BY id").all().map((row) => row.name), files);
		assert.deepEqual(await lib.applyMigrations(fresh, migrationsDir), []);
		// An existing install only runs what its ledger lacks: with every file but one recorded,
		// only that one is attempted (it fails here, on an empty schema, naming itself).
		const ledgerOnly = new lib.SqliteDatabase(join(outDir, "ledger.sqlite"));
		try {
			ledgerOnly.db.exec("CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)");
			const insert = ledgerOnly.db.prepare("INSERT INTO d1_migrations (name) VALUES (?)");
			const pending = files.find((name) => name.startsWith("0030")) ?? files[1];
			for (const name of files) if (name !== pending) insert.run(name);
			await assert.rejects(lib.applyMigrations(ledgerOnly, migrationsDir), (error) => error.message.startsWith(`Migration ${pending} failed`));
		} finally {
			ledgerOnly.db.close();
		}
	} finally {
		fresh.db.close();
	}
});

test("the Node server refuses cross-site cookie mutations before Next sees them", async () => {
	let handled = 0;
	const server = createServer((request, response) => {
		void lib.rejectCrossSiteNodeRequest(request, response, request.headers["x-test-trust"] === "1").then((blocked) => {
			if (blocked) return;
			handled += 1;
			response.end("next");
		});
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address();
	const base = `http://127.0.0.1:${port}`;
	const send = (path, headers, method = "POST") => fetch(`${base}${path}`, { method, headers, body: method === "GET" ? undefined : "x" });
	try {
		const cookie = "ep_session=abc";
		const crossSite = await send("/api/messages", { cookie, origin: "https://evil.example" });
		assert.equal(crossSite.status, 403);
		assert.deepEqual(await crossSite.json(), { error: "Cross-site request blocked" });
		assert.equal((await send("/api/messages", { cookie, origin: base })).status, 200);
		assert.equal((await send("/api/messages", { cookie, "sec-fetch-site": "same-origin" })).status, 200);
		assert.equal((await send("/api/messages", { origin: "https://evil.example" })).status, 200, "no session cookie, nothing to forge");
		assert.equal((await send("/api/inbound", { cookie, origin: "https://evil.example" })).status, 200, "webhooks are exempt");
		assert.equal((await send("/api/messages", { cookie, origin: "https://evil.example" }, "GET")).status, 200);
		// Behind a trusted proxy the public origin comes from X-Forwarded-Proto/Host.
		const proxied = { cookie, origin: "https://mail.example.com", "x-forwarded-proto": "https", "x-forwarded-host": "mail.example.com" };
		assert.equal((await send("/api/messages", { ...proxied, "x-test-trust": "1" })).status, 200);
		assert.equal((await send("/api/messages", proxied)).status, 403, "untrusted forwarding headers are ignored");
		assert.equal(handled, 6);
	} finally {
		server.closeAllConnections?.();
		server.close();
	}
});
