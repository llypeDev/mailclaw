import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

// The outbound pipeline of src/lib/email/send.ts against a migrated SQLite database:
// `processOutboundQueue`, `deliverEmail` (through it), `sweepStuckOutboundJobs` and
// `requeueScheduledOutboundJobs`. Only the edges are stubbed: the provider, the
// attachment store, webhooks, audit and follow-up writes, each driven by `control`.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(root, "tests", ".tmp-outbound-delivery-"));
after(() => rmSync(outDir, { recursive: true, force: true }));

const control = "globalThis.__outboundTest";
const mocks = {
	"@/lib/email/outbound-provider": `
		export async function getOutboundProviderConfig() { return { provider: "resend" }; }
		export async function sendThroughProvider(env, provider, message, jobId) {
			const state = ${control};
			state.provider.push({ jobId, message });
			if (state.refuse) throw new Error(state.refuse);
			return { messageId: state.providerMessageId ?? "<" + jobId + "@provider.test>" };
		}
	`,
	"@/lib/email/attachments": `
		export async function loadMessageAttachmentContents(env, messageId) {
			const state = ${control};
			state.loads.push(messageId);
			if (state.loadError) throw new Error(state.loadError);
			return state.attachments ?? [];
		}
		export async function storeMessageAttachments() { return []; }
		export function validateAttachments() {}
		export function normalizeAttachmentContent(value) { return value; }
	`,
	"@/lib/email/webhooks": `
		export async function dispatchWebhooks(env, userId, event, payload) {
			const state = ${control};
			state.webhooks.push({ event, payload });
			if (state.failWebhooks && event === "message.outbound") throw new Error("webhook store down");
		}
	`,
	"@/lib/mailboxes/audit": `
		export async function createAuditLog(env, entry) {
			const state = ${control};
			state.audit.push(entry);
			if (state.failAudit) throw new Error("audit store down");
		}
	`,
	"@/lib/follow-ups/service": `
		export async function setFollowUp(env, input) {
			const state = ${control};
			state.followUps.push(input);
			if (state.failFollowUp) throw new Error("follow-up store down");
		}
	`,
	"@/lib/email/cloud-attachment-utils": `export async function prepareCloudflareAttachments() { throw new Error("cloudflare provider not under test"); }`,
	"@/lib/tracking/open-tracking": `export async function getTrackingHostForSender() { return null; } export async function ensureTrackingToken() { return "token"; }`,
	"@/lib/email/parse": `export function buildSnippet(text) { return (text ?? "").slice(0, 100); }`,
	"@/lib/email/sender": `export async function getAuthorizedSenderAddress() { throw new Error("sendEmail not under test"); }`,
	"@/lib/contacts/service": `export async function upsertContactsFromAddresses() {}`,
	"@/lib/email/attachment-policy": `export async function getOutboundAttachmentMaxMb() { return 25; }`,
	"@/lib/compose/preferences": `export async function getComposePreferences() { return { undoSendSeconds: 15 }; }`,
};

const bundle = (entryPoints) => build({
	entryPoints,
	outdir: outDir,
	outExtension: { ".js": ".mjs" },
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node22",
	tsconfig: join(root, "tsconfig.json"),
	external: ["better-sqlite3", "drizzle-orm", "drizzle-orm/*"],
	logLevel: "silent",
	plugins: [{
		name: "outbound-mocks",
		setup(builder) {
			builder.onResolve({ filter: /^@\// }, ({ path }) => path in mocks ? { path, namespace: "mock" } : undefined);
			builder.onLoad({ filter: /.*/, namespace: "mock" }, ({ path }) => ({ contents: mocks[path], loader: "js" }));
		},
	}],
});
await bundle({ send: join(root, "src/lib/email/send.ts") });
await bundle({
	database: join(root, "server/runtime/sqlite-database.ts"),
	migrate: join(root, "server/runtime/migrate.ts"),
});

const load = (name) => import(pathToFileURL(join(outDir, `${name}.mjs`)).href);
const send = await load("send");
const { SqliteDatabase } = await load("database");
const { applyMigrations } = await load("migrate");

const MINUTE = 60 * 1000;
const seconds = (date) => Math.floor(date.getTime() / 1000);

function resetControl() {
	globalThis.__outboundTest = { provider: [], loads: [], webhooks: [], audit: [], followUps: [] };
	return globalThis.__outboundTest;
}

async function createFixture(t) {
	const state = resetControl();
	const database = new SqliteDatabase(join(outDir, `${crypto.randomUUID()}.sqlite`));
	t.after(() => database.db.close());
	await applyMigrations(database, join(root, "drizzle/migrations"));
	const sql = database.db;
	const now = seconds(new Date());
	sql.prepare("INSERT INTO users (id, email, name, password_hash, created_at) VALUES ('u1', 'kevin@example.com', 'Kevin', 'x', ?)").run(now);
	sql.prepare("INSERT INTO domains (id, user_id, hostname, zone_id, created_at) VALUES ('d1', 'u1', 'example.com', 'zone', ?)").run(now);
	sql.prepare("INSERT INTO mailboxes (id, user_id, domain_id, local_part, created_at) VALUES ('mb1', 'u1', 'd1', 'kevin', ?)").run(now);

	const queue = [];
	const env = {
		DB: database,
		OUTBOUND_QUEUE: { async send(body, options) { queue.push({ body, options }); } },
	};

	const addMessage = (id, status = "queued") => {
		sql.prepare(
			"INSERT INTO messages (id, mailbox_id, user_id, direction, from_addr, to_addr, subject, status, created_at) VALUES (?, 'mb1', 'u1', 'outbound', 'kevin@example.com', 'anna@example.org', 'Offer', ?, ?)",
		).run(id, status, now);
	};
	const addJob = (id, { messageId = null, status = "queued", scheduledAt = null, updatedAt = new Date(), payload = {} } = {}) => {
		const body = JSON.stringify({
			userId: "u1",
			from: "kevin@example.com",
			to: ["anna@example.org"],
			cc: [],
			bcc: [],
			subject: "Offer",
			html: "<p>Hi</p>",
			text: "Hi",
			mailboxId: "mb1",
			attachments: [],
			...payload,
		});
		sql.prepare(
			"INSERT INTO outbound_jobs (id, user_id, message_id, status, payload, scheduled_at, created_at, updated_at) VALUES (?, 'u1', ?, ?, ?, ?, ?, ?)",
		).run(id, messageId, status, body, scheduledAt ? seconds(scheduledAt) : null, now, seconds(updatedAt));
	};
	/** A queued message and its due job, as `sendEmail` leaves them for the queue consumer. */
	const addDueSend = (id, payload = {}) => {
		const due = new Date(Date.now() - MINUTE);
		addMessage(`msg-${id}`);
		addJob(`job-${id}`, { messageId: `msg-${id}`, scheduledAt: due, payload });
		return { kind: "email.scheduled", jobId: `job-${id}`, messageId: `msg-${id}`, scheduledAt: due.toISOString() };
	};
	const job = (id) => sql.prepare("SELECT status, error, updated_at FROM outbound_jobs WHERE id = ?").get(id);
	const message = (id) => sql.prepare("SELECT status, provider_message_id, thread_id FROM messages WHERE id = ?").get(id);
	return { env, sql, state, queue, addMessage, addJob, addDueSend, job, message };
}

// --- deliverEmail, reached through processOutboundQueue ---

test("a provider refusal marks the message and job failed, reports message.failed and rethrows", async (t) => {
	const { env, state, addDueSend, job, message } = await createFixture(t);
	const payload = addDueSend("refused");
	state.refuse = "Domain not verified";

	await assert.rejects(send.processOutboundQueue(env, payload), /Domain not verified/);
	assert.equal(state.provider.length, 1);
	assert.equal(message("msg-refused").status, "failed");
	assert.deepEqual({ ...job("job-refused"), updated_at: undefined }, { status: "failed", error: "Domain not verified", updated_at: undefined });
	assert.deepEqual(state.webhooks, [{ event: "message.failed", payload: { messageId: "msg-refused", error: "Domain not verified" } }]);
	assert.equal(state.audit.length, 0);
});

test("an accepted send records status, provider id, thread, webhook, audit and follow-up", async (t) => {
	const { env, sql, state, addDueSend, job, message } = await createFixture(t);
	const payload = addDueSend("ok", { followUpDays: 3 });
	state.providerMessageId = "<abc@provider.test>";
	sql.prepare("INSERT INTO conversation_notes (id, mailbox_id, thread_key, html, created_at, updated_at) VALUES ('note-1', 'mb1', 'msg-ok', '<p>n</p>', 0, 0)").run();

	await send.processOutboundQueue(env, payload);
	assert.deepEqual(message("msg-ok"), { status: "sent", provider_message_id: "<abc@provider.test>", thread_id: "abc@provider.test" });
	assert.equal(job("job-ok").status, "sent");
	assert.equal(job("job-ok").error, null);
	// Notes taken while the message waited move onto the thread key the send established.
	assert.equal(sql.prepare("SELECT thread_key FROM conversation_notes WHERE id = 'note-1'").get().thread_key, "abc@provider.test");
	assert.deepEqual(state.followUps, [{ messageId: "msg-ok", userId: "u1", days: 3 }]);
	assert.deepEqual(state.webhooks.map((hook) => hook.event), ["message.outbound"]);
	assert.equal(state.webhooks[0].payload.providerMessageId, "<abc@provider.test>");
	assert.equal(state.audit.length, 1);
	assert.equal(state.audit[0].action, "email.send");
});

test("a reply keeps the thread it was written in", async (t) => {
	const { env, addDueSend, message } = await createFixture(t);
	const payload = addDueSend("reply", { threadId: "existing-thread", inReplyTo: "<parent@example.org>" });
	await send.processOutboundQueue(env, payload);
	assert.equal(message("msg-reply").thread_id, "existing-thread");
	const sent = globalThis.__outboundTest.provider[0].message;
	assert.equal(sent.headers["In-Reply-To"], "<parent@example.org>");
});

test("failures after the provider accepted are logged, never reported as a failed send", async (t) => {
	const { env, state, addDueSend, job, message } = await createFixture(t);
	const payload = addDueSend("after", { followUpDays: 2 });
	state.failWebhooks = true;
	state.failAudit = true;
	state.failFollowUp = true;
	const errors = t.mock.method(console, "error", () => {});

	await send.processOutboundQueue(env, payload);
	assert.equal(message("msg-after").status, "sent");
	assert.equal(job("job-after").status, "sent");
	assert.equal(state.provider.length, 1);
	// Every step still ran, and no message.failed was dispatched for a message that went out.
	assert.equal(state.followUps.length, 1);
	assert.equal(state.audit.length, 1);
	assert.deepEqual(state.webhooks.map((hook) => hook.event), ["message.outbound"]);
	const steps = errors.mock.calls.map((call) => String(call.arguments[0]));
	assert.ok(steps.some((line) => line.includes("(follow-up reminder)")), steps.join("\n"));
	assert.ok(steps.some((line) => line.includes("(webhooks)")), steps.join("\n"));
	assert.ok(steps.some((line) => line.includes("(audit log)")), steps.join("\n"));
});

test("a message status write that fails after acceptance still settles the job and fires the webhook", async (t) => {
	const { env, sql, state, addDueSend, job, message } = await createFixture(t);
	const payload = addDueSend("nostatus");
	sql.exec("CREATE TRIGGER test_block_sent BEFORE UPDATE OF status ON messages WHEN NEW.status = 'sent' BEGIN SELECT RAISE(ABORT, 'messages locked'); END;");
	const errors = t.mock.method(console, "error", () => {});

	await send.processOutboundQueue(env, payload);
	assert.equal(message("msg-nostatus").status, "queued");
	assert.equal(job("job-nostatus").status, "sent");
	assert.deepEqual(state.webhooks.map((hook) => hook.event), ["message.outbound"]);
	assert.ok(errors.mock.calls.some((call) => String(call.arguments[0]).includes("(message status)")));
});

test("a job status write that fails after acceptance leaves it to the sweep, which marks it sent", async (t) => {
	const { env, sql, state, addDueSend, job, message } = await createFixture(t);
	const payload = addDueSend("nojob");
	sql.exec("CREATE TRIGGER test_block_job BEFORE UPDATE OF status ON outbound_jobs WHEN NEW.status = 'sent' BEGIN SELECT RAISE(ABORT, 'jobs locked'); END;");
	t.mock.method(console, "error", () => {});

	await send.processOutboundQueue(env, payload);
	assert.equal(message("msg-nojob").status, "sent");
	assert.equal(job("job-nojob").status, "sending");

	sql.exec("DROP TRIGGER test_block_job");
	assert.equal(await send.sweepStuckOutboundJobs(env, new Date(Date.now() + 16 * MINUTE)), 1);
	assert.equal(job("job-nojob").status, "sent");
	assert.equal(job("job-nojob").error, null);
	assert.equal(state.provider.length, 1, "the sweep never re-sends");
});

// --- processOutboundQueue ---

test("attachments are loaded before the job is claimed, so a load failure leaves it queued for retry", async (t) => {
	const { env, state, addDueSend, job, message } = await createFixture(t);
	const payload = addDueSend("attach");
	state.loadError = "bucket unavailable";

	await assert.rejects(send.processOutboundQueue(env, payload), /bucket unavailable/);
	assert.equal(job("job-attach").status, "queued");
	assert.equal(message("msg-attach").status, "queued");
	assert.equal(state.provider.length, 0);

	// The queue retry finds the job still claimable and sends it with the loaded files.
	delete state.loadError;
	state.attachments = [{ filename: "a.txt", type: "text/plain", content: new Uint8Array([104, 105]), disposition: "attachment" }];
	await send.processOutboundQueue(env, payload);
	assert.equal(job("job-attach").status, "sent");
	assert.equal(state.provider.length, 1);
	assert.deepEqual(state.provider[0].message.attachments.map((file) => file.filename), ["a.txt"]);
});

test("two consumers of the same job deliver it once", async (t) => {
	const { env, state, addDueSend, job } = await createFixture(t);
	const payload = addDueSend("twice");
	await Promise.all([send.processOutboundQueue(env, payload), send.processOutboundQueue(env, payload)]);
	assert.equal(state.provider.length, 1);
	assert.equal(job("job-twice").status, "sent");
});

test("a job that is not due yet is re-enqueued without claiming or loading", async (t) => {
	const { env, state, queue, addMessage, addJob, job } = await createFixture(t);
	const later = new Date(Date.now() + 10 * MINUTE);
	addMessage("msg-later");
	addJob("job-later", { messageId: "msg-later", scheduledAt: later });

	await send.processOutboundQueue(env, { kind: "email.scheduled", jobId: "job-later", messageId: "msg-later", scheduledAt: later.toISOString() });
	assert.equal(job("job-later").status, "queued");
	assert.equal(state.loads.length, 0);
	assert.equal(state.provider.length, 0);
	assert.equal(queue.length, 1);
	assert.equal(queue[0].body.jobId, "job-later");
	assert.ok(queue[0].options.delaySeconds >= 590 && queue[0].options.delaySeconds <= 600, String(queue[0].options.delaySeconds));
});

test("a job that already left the queue is ignored", async (t) => {
	const { env, state, addMessage, addJob } = await createFixture(t);
	addMessage("msg-done", "sent");
	addJob("job-done", { messageId: "msg-done", status: "sent", scheduledAt: new Date(Date.now() - MINUTE) });
	await send.processOutboundQueue(env, { kind: "email.scheduled", jobId: "job-done", messageId: "msg-done", scheduledAt: new Date().toISOString() });
	await send.processOutboundQueue(env, { kind: "email.scheduled", jobId: "missing", messageId: "msg-done", scheduledAt: new Date().toISOString() });
	assert.equal(state.loads.length, 0);
	assert.equal(state.provider.length, 0);
});

// --- sweepStuckOutboundJobs ---

test("the sweep settles jobs stuck in sending for more than 15 minutes without re-sending", async (t) => {
	const { env, state, queue, addMessage, addJob, job, message } = await createFixture(t);
	const old = new Date(Date.now() - 20 * MINUTE);
	addMessage("m-sent", "sent");
	addJob("j-sent", { messageId: "m-sent", status: "sending", updatedAt: old });
	addMessage("m-lost", "queued");
	addJob("j-lost", { messageId: "m-lost", status: "sending", updatedAt: old });
	addMessage("m-trashed", "trash");
	addJob("j-trashed", { messageId: "m-trashed", status: "sending", updatedAt: old });
	addJob("j-orphan", { status: "sending", updatedAt: old });
	addMessage("m-fresh", "queued");
	addJob("j-fresh", { messageId: "m-fresh", status: "sending", updatedAt: new Date(Date.now() - 5 * MINUTE) });
	addMessage("m-queued", "queued");
	addJob("j-queued", { messageId: "m-queued", status: "queued", updatedAt: old });

	assert.equal(await send.sweepStuckOutboundJobs(env), 4);
	// The message already went out; only the job's own write was missing.
	assert.equal(job("j-sent").status, "sent");
	assert.equal(job("j-sent").error, null);
	assert.equal(message("m-sent").status, "sent");
	// Unknown outcome: reported as failed with a note, and the queued message follows.
	assert.equal(job("j-lost").status, "failed");
	assert.match(job("j-lost").error, /interrupted/i);
	assert.equal(message("m-lost").status, "failed");
	assert.ok(job("j-lost").updated_at > seconds(old));
	// Only a still-queued message is marked failed; one the user moved keeps its status.
	assert.equal(job("j-trashed").status, "failed");
	assert.equal(message("m-trashed").status, "trash");
	assert.equal(job("j-orphan").status, "failed");
	// Recent sends and jobs in other states are left alone.
	assert.equal(job("j-fresh").status, "sending");
	assert.equal(job("j-queued").status, "queued");

	assert.equal(state.provider.length, 0);
	assert.equal(state.loads.length, 0);
	assert.equal(queue.length, 0);
	assert.equal(await send.sweepStuckOutboundJobs(env), 0, "a second run finds nothing");
});

test("the sweep threshold is strictly more than 15 minutes since the last update", async (t) => {
	const { env, addMessage, addJob, job } = await createFixture(t);
	const updated = new Date(Math.floor(Date.now() / 1000) * 1000);
	addMessage("m-edge", "queued");
	addJob("j-edge", { messageId: "m-edge", status: "sending", updatedAt: updated });

	assert.equal(await send.sweepStuckOutboundJobs(env, new Date(updated.getTime() + 15 * MINUTE)), 0);
	assert.equal(job("j-edge").status, "sending");
	assert.equal(await send.sweepStuckOutboundJobs(env, new Date(updated.getTime() + 15 * MINUTE + 1000)), 1);
	assert.equal(job("j-edge").status, "failed");
});

test("the sweep handles at most 50 jobs per run", async (t) => {
	const { env, addJob, sql } = await createFixture(t);
	const old = new Date(Date.now() - 30 * MINUTE);
	for (let index = 0; index < 60; index++) addJob(`bulk-${index}`, { status: "sending", updatedAt: old });
	assert.equal(await send.sweepStuckOutboundJobs(env), 50);
	assert.equal(await send.sweepStuckOutboundJobs(env), 10);
	assert.equal(sql.prepare("SELECT count(*) AS n FROM outbound_jobs WHERE status = 'sending'").get().n, 0);
});

// --- requeueScheduledOutboundJobs ---

test("restart re-arms queued scheduled and undo-window sends, and nothing else", async (t) => {
	const { env, queue, addMessage, addJob } = await createFixture(t);
	const now = Date.now();
	addMessage("m-hour");
	addJob("j-hour", { messageId: "m-hour", scheduledAt: new Date(now + 60 * MINUTE) });
	addMessage("m-undo");
	addJob("j-undo", { messageId: "m-undo", scheduledAt: new Date(now - 2 * MINUTE) });
	addMessage("m-far");
	addJob("j-far", { messageId: "m-far", scheduledAt: new Date(now + 3 * 24 * 60 * MINUTE) });
	addMessage("m-now");
	addJob("j-now", { messageId: "m-now" });
	addMessage("m-sending");
	addJob("j-sending", { messageId: "m-sending", status: "sending", scheduledAt: new Date(now - MINUTE) });
	addMessage("m-failed", "failed");
	addJob("j-failed", { messageId: "m-failed", status: "failed", scheduledAt: new Date(now - MINUTE) });
	addJob("j-orphan", { scheduledAt: new Date(now + MINUTE) });

	assert.equal(await send.requeueScheduledOutboundJobs(env), 3);
	const byJob = Object.fromEntries(queue.map((entry) => [entry.body.jobId, entry]));
	assert.deepEqual(Object.keys(byJob).sort(), ["j-far", "j-hour", "j-undo"]);
	for (const entry of queue) {
		assert.equal(entry.body.kind, "email.scheduled");
		assert.equal(entry.body.messageId, entry.body.jobId.replace("j-", "m-"));
	}
	const hourDelay = byJob["j-hour"].options.delaySeconds;
	assert.ok(hourDelay > 3590 && hourDelay <= 3600, String(hourDelay));
	assert.equal(byJob["j-undo"].options.delaySeconds, 1, "an overdue send wakes at once");
	assert.equal(byJob["j-far"].options.delaySeconds, 24 * 60 * 60, "later sends wake at the delay cap");
	assert.equal(byJob["j-hour"].body.scheduledAt, new Date(Math.floor((now + 60 * MINUTE) / 1000) * 1000).toISOString());
});

test("re-armed jobs deliver once even when the restart repeats", async (t) => {
	const { env, state, queue, addMessage, addJob, job, message } = await createFixture(t);
	addMessage("m-undo");
	addJob("j-undo", { messageId: "m-undo", scheduledAt: new Date(Date.now() - MINUTE) });
	addMessage("m-later");
	addJob("j-later", { messageId: "m-later", scheduledAt: new Date(Date.now() + 30 * MINUTE) });

	await send.requeueScheduledOutboundJobs(env);
	await send.requeueScheduledOutboundJobs(env);
	assert.equal(queue.length, 4);
	const woken = queue.splice(0);
	for (const entry of woken) await send.processOutboundQueue(env, entry.body);

	assert.equal(state.provider.length, 1);
	assert.equal(state.provider[0].jobId, "j-undo");
	assert.equal(job("j-undo").status, "sent");
	assert.equal(message("m-undo").status, "sent");
	// The later send is not due: each wake-up re-enqueues it rather than sending.
	assert.equal(job("j-later").status, "queued");
	assert.deepEqual(queue.map((entry) => entry.body.jobId), ["j-later", "j-later"]);
	assert.equal(await send.requeueScheduledOutboundJobs(env), 1, "a delivered job is not re-armed");
});
