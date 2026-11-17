import assert from "node:assert/strict";
import test, { after } from "node:test";
import { loadAppWithSqlite, recordingBucket, seconds, DAY_MS } from "./helpers/app-sqlite.mjs";

// src/lib/import/jobs.ts against a migrated SQLite database: a file job staged in the bucket is
// imported one batch per queue message with its counters and cursor recorded; a cancel while a chunk
// runs turns the chunk's final write into a no-op; IMAP chunks shrink after a throw and on a queue
// redelivery; the sweep fails idle jobs after 30 minutes and prunes finished ones after 7 days; and a
// failed job resumes from its cursor. Only the IMAP network layer (fetchImapMessages) is replaced.
const state = { fetch: null, fetchCalls: [] };
globalThis.__importJobsTest = state;
after(() => delete globalThis.__importJobsTest);

const app = await loadAppWithSqlite({
	name: "import-jobs",
	exports: [
		`export * from "./src/lib/import/jobs.ts";`,
		`export { importBatchKey, IMPORT_BATCH_SIZE } from "./src/lib/import/staging.ts";`,
	],
	mocks: {
		"./imap": `export async function fetchImapMessages(options) {
			globalThis.__importJobsTest.fetchCalls.push(options);
			return globalThis.__importJobsTest.fetch(options);
		}`,
	},
});
after(app.dispose);
const lib = app.lib;

const encoder = new TextEncoder();
const rawMessage = (n, { messageId = `<m${n}@example.org>` } = {}) => encoder.encode([
	`Message-ID: ${messageId}`,
	"From: Anna <anna@example.org>",
	"To: kevin@example.com",
	`Subject: Message ${n}`,
	"Date: Mon, 16 Nov 2026 10:00:00 +0000",
	"",
	`Body ${n}`,
	"",
].join("\r\n")).buffer;

/** recordingBucket plus the reads jobs.ts makes (get, head). `onGet` runs after an object is read, before it is returned. */
function bucketWithReads() {
	const bucket = recordingBucket();
	bucket.onGet = null;
	bucket.get = async (key) => {
		const value = bucket.objects.get(key);
		if (bucket.onGet) await bucket.onGet(key);
		if (value === undefined) return null;
		const bytes = typeof value === "string" ? encoder.encode(value) : new Uint8Array(value instanceof ArrayBuffer ? value : value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
		return { key, size: bytes.byteLength, arrayBuffer: async () => bytes.slice().buffer, text: async () => new TextDecoder().decode(bytes) };
	};
	bucket.head = async (key) => (bucket.objects.has(key) ? { key } : null);
	return bucket;
}

async function fixture(t) {
	const database = await app.openDatabase(t);
	const sql = database.db;
	const bucket = bucketWithReads();
	const sent = [];
	const env = { DB: database, BUCKET: bucket, OUTBOUND_QUEUE: { async send(message) { sent.push(structuredClone(message)); } } };
	const now = seconds(new Date());
	sql.prepare("INSERT INTO users (id, email, name, password_hash, created_at) VALUES ('u1', 'kevin@example.com', 'Kevin', 'x', ?)").run(now);
	sql.prepare("INSERT INTO users (id, email, name, password_hash, created_at) VALUES ('u2', 'bea@example.com', 'Bea', 'x', ?)").run(now);
	sql.prepare("INSERT INTO domains (id, user_id, hostname, zone_id, created_at) VALUES ('d1', 'u1', 'example.com', 'zone', ?)").run(now);
	sql.prepare("INSERT INTO mailboxes (id, user_id, domain_id, local_part, created_at) VALUES ('mb1', 'u1', 'd1', 'kevin', ?)").run(now);
	state.fetch = null;
	state.fetchCalls = [];
	const job = (id) => sql.prepare("SELECT * FROM import_jobs WHERE id = ?").get(id);
	const count = (table) => sql.prepare(`SELECT count(*) AS n FROM ${table}`).get().n;
	return { database, sql, bucket, sent, env, job, count };
}

const createFileJob = (f, messages, { destination = "system:inbox" } = {}) => lib.createFileImportJob(f.env, {
	userId: "u1",
	mailboxId: "mb1",
	label: "export.mbox",
	destination,
	messages: messages.map((raw, index) => ({ filename: `export.mbox#${index + 1}`, raw })),
});

test("a file job is staged in batches and imported one batch per queue message", async (t) => {
	const f = await fixture(t);
	const total = lib.IMPORT_BATCH_SIZE + 5;
	// The last message repeats the first one's Message-ID, so it is skipped as a duplicate.
	const raws = Array.from({ length: total - 1 }, (_, n) => rawMessage(n)).concat(rawMessage(0));
	const summary = await createFileJob(f, raws);

	assert.equal(summary.status, "queued");
	assert.equal(summary.total, total);
	assert.equal(summary.kind, "file");
	assert.deepEqual([...f.bucket.objects.keys()].sort(), [lib.importBatchKey(summary.id, 0), lib.importBatchKey(summary.id, 1)]);
	assert.deepEqual(f.sent, [{ kind: "import.run", jobId: summary.id }]);
	assert.deepEqual(JSON.parse(f.job(summary.id).spec), { destination: "system:inbox", batches: 2 });

	await lib.processImportJob(f.env, f.sent.shift());
	let row = f.job(summary.id);
	assert.equal(row.status, "running");
	assert.ok(row.started_at);
	assert.equal(row.finished_at, null);
	assert.deepEqual([row.processed, row.imported, row.skipped, row.error_count], [lib.IMPORT_BATCH_SIZE, lib.IMPORT_BATCH_SIZE, 0, 0]);
	assert.deepEqual(JSON.parse(row.cursor), { batch: 1 });
	assert.equal(f.bucket.objects.has(lib.importBatchKey(summary.id, 0)), false, "the consumed batch is deleted");
	assert.deepEqual(f.sent, [{ kind: "import.run", jobId: summary.id }], "the next chunk is queued");

	await lib.processImportJob(f.env, f.sent.shift());
	row = f.job(summary.id);
	assert.equal(row.status, "completed");
	assert.ok(row.finished_at);
	assert.deepEqual([row.total, row.processed, row.imported, row.skipped], [total, total, total - 1, 1]);
	assert.deepEqual(JSON.parse(row.cursor), { batch: 2 });
	assert.equal(f.sent.length, 0, "nothing more is queued once the last batch is done");
	assert.equal(f.bucket.objects.has(lib.importBatchKey(summary.id, 1)), false);
	assert.equal(f.count("messages"), total - 1);
	assert.equal(f.sql.prepare("SELECT count(*) AS n FROM messages WHERE raw_r2_key LIKE 'imports/v2/%' AND status = 'received'").get().n, total - 1);

	// A redelivered message for a finished job does nothing.
	await lib.processImportJob(f.env, { kind: "import.run", jobId: summary.id });
	assert.equal(f.job(summary.id).processed, total);
	await lib.processImportJob(f.env, { kind: "import.run", jobId: "imp_missing" });

	const listed = await lib.listImportJobs(f.env, "u1");
	assert.deepEqual(listed.map((job) => [job.id, job.status, job.imported]), [[summary.id, "completed", total - 1]]);
	assert.deepEqual(await lib.listImportJobs(f.env, "u2"), []);
});

test("per-message failures are counted, and only the first 20 are kept", async (t) => {
	const f = await fixture(t);
	const total = lib.IMPORT_BATCH_SIZE;
	// A folder that does not exist fails every insert on its foreign key.
	const summary = await createFileJob(f, Array.from({ length: total }, (_, n) => rawMessage(n)), { destination: "folder:missing" });
	await lib.processImportJob(f.env, f.sent.shift());
	const row = f.job(summary.id);
	assert.equal(row.status, "completed");
	assert.deepEqual([row.processed, row.imported, row.skipped, row.error_count], [total, 0, total, total]);
	const errors = JSON.parse(row.errors);
	assert.equal(errors.length, 20);
	assert.match(errors[0], /^export\.mbox#1: .*FOREIGN KEY/i);
	assert.equal(f.count("messages"), 0);
});

test("a cancel while a chunk runs makes the chunk's final write a no-op", async (t) => {
	const f = await fixture(t);
	const summary = await createFileJob(f, Array.from({ length: lib.IMPORT_BATCH_SIZE + 1 }, (_, n) => rawMessage(n)));
	f.bucket.onGet = async () => {
		f.bucket.onGet = null;
		assert.equal(await lib.cancelOrDismissImportJob(f.env, "u1", summary.id), true);
	};
	await lib.processImportJob(f.env, f.sent.shift());

	const row = f.job(summary.id);
	assert.equal(row.status, "cancelled");
	assert.ok(row.finished_at);
	assert.deepEqual([row.processed, row.imported, row.skipped], [0, 0, 0], "the cancelled job's counters are not touched");
	assert.deepEqual(JSON.parse(row.cursor), { batch: 0 });
	assert.equal(f.sent.length, 0, "no further chunk is queued");
	assert.equal(f.bucket.objects.size - f.count("messages"), 0, "the cancel removed every staged batch; only the imported raw MIME is left");
	// Messages stored before the cancel landed stay: the chunk was already running.
	assert.equal(f.count("messages"), lib.IMPORT_BATCH_SIZE);
});

test("cancel, dismiss and ownership", async (t) => {
	const f = await fixture(t);
	const summary = await createFileJob(f, [rawMessage(1)]);
	assert.equal(await lib.cancelOrDismissImportJob(f.env, "u2", summary.id), false, "another user's job");
	assert.equal(await lib.cancelOrDismissImportJob(f.env, "u1", "imp_missing"), false);
	assert.equal(f.job(summary.id).status, "queued");

	assert.equal(await lib.cancelOrDismissImportJob(f.env, "u1", summary.id), true);
	assert.equal(f.job(summary.id).status, "cancelled");
	assert.deepEqual(f.bucket.deleted, [lib.importBatchKey(summary.id, 0)]);
	// A cancelled job's queued message is ignored.
	await lib.processImportJob(f.env, f.sent.shift());
	assert.equal(f.count("messages"), 0);

	assert.equal(await lib.cancelOrDismissImportJob(f.env, "u1", summary.id), true, "a second call dismisses the finished record");
	assert.equal(f.job(summary.id), undefined);
});

test("a missing staged batch fails the job, and resuming needs the batch back", async (t) => {
	const f = await fixture(t);
	const summary = await createFileJob(f, [rawMessage(1), rawMessage(2)]);
	const key = lib.importBatchKey(summary.id, 0);
	const staged = f.bucket.objects.get(key);
	f.bucket.objects.delete(key);

	await lib.processImportJob(f.env, f.sent.shift());
	let row = f.job(summary.id);
	assert.equal(row.status, "failed");
	assert.equal(row.error, "Uploaded files are no longer available; upload them again");
	assert.ok(row.finished_at);

	assert.deepEqual(await lib.resumeImportJob(f.env, "u1", summary.id), { ok: false, status: 409, error: "Uploaded files are no longer available; upload them again" });
	assert.deepEqual(await lib.resumeImportJob(f.env, "u2", summary.id), { ok: false, status: 404, error: "Import not found" });

	f.bucket.objects.set(key, staged);
	const resumed = await lib.resumeImportJob(f.env, "u1", summary.id);
	assert.equal(resumed.ok, true);
	assert.equal(resumed.job.status, "queued");
	assert.equal(resumed.job.error, null);
	assert.equal(resumed.job.finishedAt, null);
	assert.deepEqual(f.sent, [{ kind: "import.run", jobId: summary.id }]);
	assert.deepEqual(await lib.resumeImportJob(f.env, "u1", summary.id), { ok: false, status: 409, error: "Only a failed import can be resumed" });

	await lib.processImportJob(f.env, f.sent.shift());
	row = f.job(summary.id);
	assert.equal(row.status, "completed");
	assert.equal(row.imported, 2);
});

const IMAP_SPEC = {
	host: "imap.example.org",
	port: 993,
	secure: true,
	username: "kevin",
	limit: 8,
	importAll: false,
	sources: [
		{ folder: "INBOX", destination: "system:inbox" },
		{ folder: "Sent", destination: "system:sent" },
	],
};

/** Serves `count` messages from a folder of `total`, newest first, like selectImapUidBatch. */
const serve = (folder, total) => ({ limit, offset }) => {
	const end = Math.max(total - offset, 0);
	const start = Math.max(0, end - limit);
	return {
		messages: Array.from({ length: end - start }, (_, index) => ({ filename: `${folder}#${start + index}`, raw: rawMessage(`${folder}-${start + index}`) })),
		total,
		nextOffset: start > 0 ? offset + (end - start) : null,
	};
};

const createImapJob = (f, spec = IMAP_SPEC) => lib.createImapImportJob(f.env, { userId: "u1", mailboxId: "mb1", password: "secret", spec });
const cursorOf = (f, id) => JSON.parse(f.job(id).cursor);

test("an IMAP chunk that throws is retried at half the size, and a redelivery halves it again", async (t) => {
	const f = await fixture(t);
	const summary = await createImapJob(f);
	assert.equal(summary.label, "kevin @ imap.example.org");
	assert.equal(f.job(summary.id).spec.includes("secret"), false, "the password is never stored");
	assert.deepEqual(f.sent, [{ kind: "import.run", jobId: summary.id, imapPassword: "secret" }]);

	state.fetch = () => {
		throw new Error("IMAP connection closed unexpectedly");
	};
	await lib.processImportJob(f.env, f.sent.shift());
	assert.equal(state.fetchCalls[0].limit, 8, "the first chunk is the job's limit (under the default of 50)");
	assert.equal(state.fetchCalls[0].password, "secret");
	assert.deepEqual(cursorOf(f, summary.id), { source: 0, done: 0, counted: false, failures: 1, size: 4 });
	assert.equal(f.job(summary.id).status, "running");
	assert.deepEqual(f.sent, [{ kind: "import.run", jobId: summary.id, imapPassword: "secret" }], "the same chunk is queued again");

	state.fetch = serve("INBOX", 10);
	await lib.processImportJob(f.env, { ...f.sent.shift(), attempt: 1 });
	assert.deepEqual([state.fetchCalls[1].limit, state.fetchCalls[1].offset], [4, 0]);
	// A clean chunk drops the failure count and grows the size back by half.
	assert.deepEqual(cursorOf(f, summary.id), { source: 0, done: 4, counted: true, size: 6 });
	let row = f.job(summary.id);
	assert.deepEqual([row.total, row.imported], [8, 4], "the folder counts min(limit, folder size) once");

	// The queue redelivered the message (e.g. a resource-limit 503): attempt 2 halves the chunk.
	await lib.processImportJob(f.env, { ...f.sent.shift(), attempt: 2 });
	assert.deepEqual([state.fetchCalls[2].limit, state.fetchCalls[2].offset], [2, 4]);
	assert.equal("attempt" in f.sent[0], false, "the delivery count is never forwarded");
	assert.deepEqual(cursorOf(f, summary.id), { source: 0, done: 6, counted: true, size: 3 });
	row = f.job(summary.id);
	assert.deepEqual([row.total, row.imported], [8, 6], "a counted folder is not added to the total twice");

	await lib.processImportJob(f.env, f.sent.shift());
	assert.deepEqual([state.fetchCalls[3].limit, state.fetchCalls[3].offset], [2, 6], "capped by what is left of the limit");
	assert.deepEqual(cursorOf(f, summary.id), { source: 1, done: 0, counted: false, size: 3 }, "the limit is reached, so the next folder starts");

	state.fetch = serve("Sent", 1);
	await lib.processImportJob(f.env, f.sent.shift());
	assert.equal(state.fetchCalls[4].folder, "Sent");
	row = f.job(summary.id);
	assert.equal(row.status, "completed");
	assert.deepEqual([row.total, row.processed, row.imported], [9, 9, 9]);
	assert.equal(f.sent.length, 0);
	assert.equal(f.sql.prepare("SELECT count(*) AS n FROM messages WHERE status = 'sent'").get().n, 1);
});

test("an IMAP job fails on a credential error at once and after four failed chunks otherwise", async (t) => {
	const f = await fixture(t);
	const denied = await createImapJob(f);
	state.fetch = () => {
		throw new Error("IMAP command failed: A0002 NO [AUTHENTICATIONFAILED] Invalid credentials");
	};
	await lib.processImportJob(f.env, f.sent.shift());
	let row = f.job(denied.id);
	assert.equal(row.status, "failed");
	assert.match(row.error, /AUTHENTICATIONFAILED/);
	assert.equal(f.sent.length, 0);

	const flaky = await createImapJob(f);
	state.fetch = () => {
		throw new Error("socket hang up");
	};
	const sizes = [];
	for (let attempt = 0; attempt < 4; attempt += 1) {
		await lib.processImportJob(f.env, f.sent.shift());
		sizes.push(cursorOf(f, flaky.id).size ?? null);
	}
	row = f.job(flaky.id);
	assert.deepEqual(sizes, [4, 2, 1, 1]);
	assert.equal(row.status, "failed");
	assert.equal(row.error, "socket hang up");
	assert.equal(f.sent.length, 0);

	// A lost queue message (no password) cannot be retried smaller either.
	const lost = await createImapJob(f);
	f.sent.length = 0;
	await lib.processImportJob(f.env, { kind: "import.run", jobId: lost.id });
	assert.equal(f.job(lost.id).error, "IMAP credentials were lost; start the import again");
	assert.equal(f.job(lost.id).status, "failed");
});

test("an IMAP folder that cannot be opened is skipped with an error", async (t) => {
	const f = await fixture(t);
	const summary = await createImapJob(f, { ...IMAP_SPEC, sources: [{ folder: "[Gmail]", destination: "system:inbox" }, IMAP_SPEC.sources[0]] });
	state.fetch = () => {
		throw new Error("IMAP command failed: A0003 NO [NONEXISTENT] Unknown Mailbox");
	};
	await lib.processImportJob(f.env, f.sent.shift());
	let row = f.job(summary.id);
	assert.equal(row.status, "running");
	assert.deepEqual(JSON.parse(row.errors), ["[Gmail]: IMAP command failed: A0003 NO [NONEXISTENT] Unknown Mailbox"]);
	assert.deepEqual(cursorOf(f, summary.id), { source: 1, done: 0, counted: false });
	assert.equal(lib.toImportJobSummary({
		...summary,
		status: "running",
		spec: row.spec,
		cursor: row.cursor,
		errors: row.errors,
		errorCount: row.error_count,
		createdAt: new Date(),
		startedAt: null,
		finishedAt: null,
	}).currentSource, "INBOX");

	state.fetch = serve("INBOX", 2);
	await lib.processImportJob(f.env, f.sent.shift());
	row = f.job(summary.id);
	assert.equal(row.status, "completed");
	assert.deepEqual([row.imported, row.error_count], [2, 1]);
});

test("resuming an IMAP job needs the password and clears the failure count", async (t) => {
	const f = await fixture(t);
	const summary = await createImapJob(f);
	f.sent.length = 0;
	f.sql.prepare("UPDATE import_jobs SET status = 'failed', error = 'socket hang up', finished_at = 1, cursor = ? WHERE id = ?")
		.run(JSON.stringify({ source: 1, done: 3, counted: true, size: 2, failures: 3 }), summary.id);

	assert.deepEqual(await lib.resumeImportJob(f.env, "u1", summary.id), { ok: false, status: 400, error: "Enter the IMAP password to resume" });
	const resumed = await lib.resumeImportJob(f.env, "u1", summary.id, "again");
	assert.equal(resumed.ok, true);
	assert.equal(resumed.job.status, "queued");
	assert.deepEqual(cursorOf(f, summary.id), { source: 1, done: 3, counted: true, size: 2 });
	assert.deepEqual(f.sent, [{ kind: "import.run", jobId: summary.id, imapPassword: "again" }]);
});

test("the sweep fails jobs idle for 30 minutes and prunes finished ones after 7 days", async (t) => {
	const f = await fixture(t);
	const now = new Date("2026-11-16T12:00:00Z");
	const MINUTE = 60 * 1000;
	const add = (id, status, { updatedAt = now, finishedAt = null, batches = 1, kind = "file" } = {}) => {
		f.sql.prepare(
			"INSERT INTO import_jobs (id, user_id, mailbox_id, kind, label, status, spec, cursor, created_at, updated_at, finished_at) VALUES (?, 'u1', 'mb1', ?, 'x', ?, ?, '{}', ?, ?, ?)",
		).run(id, kind, status, JSON.stringify(kind === "file" ? { destination: "system:inbox", batches } : IMAP_SPEC), seconds(now), seconds(updatedAt), finishedAt ? seconds(finishedAt) : null);
		if (kind === "file") for (let batch = 0; batch < batches; batch += 1) f.bucket.objects.set(lib.importBatchKey(id, batch), new Uint8Array(1));
	};
	add("idleRunning", "running", { updatedAt: new Date(now.getTime() - 31 * MINUTE) });
	add("idleQueued", "queued", { updatedAt: new Date(now.getTime() - 31 * MINUTE), kind: "imap" });
	add("busy", "running", { updatedAt: new Date(now.getTime() - 29 * MINUTE) });
	add("oldDone", "completed", { finishedAt: new Date(now.getTime() - 8 * DAY_MS), batches: 2 });
	add("oldFailed", "failed", { finishedAt: new Date(now.getTime() - 8 * DAY_MS), kind: "imap" });
	add("oldCancelled", "cancelled", { finishedAt: new Date(now.getTime() - 7 * DAY_MS - MINUTE) });
	add("recentDone", "completed", { finishedAt: new Date(now.getTime() - 6 * DAY_MS) });

	await lib.sweepImportJobs(f.env, now);

	const rows = Object.fromEntries(f.sql.prepare("SELECT id, status, error, finished_at FROM import_jobs").all().map((row) => [row.id, row]));
	assert.deepEqual(Object.keys(rows).sort(), ["busy", "idleQueued", "idleRunning", "recentDone"]);
	for (const id of ["idleRunning", "idleQueued"]) {
		assert.equal(rows[id].status, "failed", id);
		assert.equal(rows[id].error, "Import was interrupted");
		assert.equal(rows[id].finished_at, seconds(now));
	}
	assert.equal(rows.busy.status, "running");
	assert.deepEqual(f.bucket.deleted.sort(), [
		lib.importBatchKey("oldCancelled", 0),
		lib.importBatchKey("oldDone", 0),
		lib.importBatchKey("oldDone", 1),
	]);
	assert.ok(f.bucket.objects.has(lib.importBatchKey("idleRunning", 0)), "a freshly failed job keeps its batches so it can resume");

	// Idle-failed jobs are pruned only once they have been finished for 7 days.
	await lib.sweepImportJobs(f.env, new Date(now.getTime() + 7 * DAY_MS + MINUTE));
	assert.deepEqual(f.sql.prepare("SELECT id FROM import_jobs ORDER BY id").all().map((row) => row.id), ["busy"]);
});
