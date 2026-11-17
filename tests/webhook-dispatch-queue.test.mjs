import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

// dispatchWebhooks (src/lib/email/webhooks.ts) records a delivery row per subscribed hook and queues
// its first attempt on OUTBOUND_QUEUE instead of posting inline; the queue consumer
// (processWebhookRetry) then delivers it and skips deliveries that already settled.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(root, "tests", ".tmp-webhook-dispatch-"));
after(() => rmSync(outDir, { recursive: true, force: true }));

const mocks = {
	"@/lib/security/public-url": `
		export const PUBLIC_HTTPS_URL_MESSAGE = "Use a public https URL";
		export function isPublicHttpsUrl(url) { return url.startsWith("https://"); }
		export async function assertResolvesPublic() {}
	`,
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
		name: "webhook-mocks",
		setup(builder) {
			builder.onResolve({ filter: /^@\// }, ({ path }) => path in mocks ? { path, namespace: "mock" } : undefined);
			builder.onLoad({ filter: /.*/, namespace: "mock" }, ({ path }) => ({ contents: mocks[path], loader: "js" }));
		},
	}],
});
await bundle({ webhooks: join(root, "src/lib/email/webhooks.ts") });
await bundle({
	database: join(root, "server/runtime/sqlite-database.ts"),
	migrate: join(root, "server/runtime/migrate.ts"),
});

const load = (name) => import(pathToFileURL(join(outDir, `${name}.mjs`)).href);
const { dispatchWebhooks, processWebhookRetry, runDelivery } = await load("webhooks");
const { SqliteDatabase } = await load("database");
const { applyMigrations } = await load("migrate");

async function createFixture(t, { queueFails = false } = {}) {
	const database = new SqliteDatabase(join(outDir, `${crypto.randomUUID()}.sqlite`));
	t.after(() => database.db.close());
	await applyMigrations(database, join(root, "drizzle/migrations"));
	const sql = database.db;
	const now = Math.floor(Date.now() / 1000);
	sql.prepare("INSERT INTO users (id, email, name, password_hash, created_at) VALUES ('u1', 'kevin@example.com', 'Kevin', 'x', ?)").run(now);
	const addHook = (id, events, enabled = 1) =>
		sql.prepare("INSERT INTO webhooks (id, user_id, url, secret, events, enabled, max_attempts, created_at) VALUES (?, 'u1', ?, 's', ?, ?, 3, ?)")
			.run(id, `https://hooks.example.com/${id}`, JSON.stringify(events), enabled, now);

	const queued = [];
	const env = {
		DB: database,
		OUTBOUND_QUEUE: {
			async send(body, options) {
				if (queueFails) throw new Error("queue down");
				queued.push({ body, options });
			},
			async sendBatch(messages) {
				if (queueFails) throw new Error("queue down");
				for (const message of messages) queued.push({ body: message.body, options: { delaySeconds: message.delaySeconds } });
			},
		},
	};
	const deliveries = () => sql.prepare("SELECT id, webhook_id AS webhookId, status, attempts FROM webhook_deliveries ORDER BY webhook_id").all();
	return { env, sql, addHook, queued, deliveries };
}

function mockFetch(t, status = 200) {
	const calls = [];
	t.mock.method(globalThis, "fetch", async (url, init) => {
		calls.push({ url: String(url), headers: init.headers });
		return new Response("ok", { status });
	});
	return calls;
}

test("dispatch records pending deliveries and queues their first attempt without posting", async (t) => {
	const fixture = await createFixture(t);
	fixture.addHook("wh1", ["message.inbound"]);
	fixture.addHook("wh2", ["message.inbound", "message.outbound"]);
	fixture.addHook("wh3", ["message.outbound"]);
	fixture.addHook("wh4", ["message.inbound"], 0);
	const calls = mockFetch(t);

	await dispatchWebhooks(fixture.env, "u1", "message.inbound", { messageId: "m1" });

	assert.equal(calls.length, 0, "nothing is posted inline");
	const rows = fixture.deliveries();
	assert.deepEqual(rows.map((row) => [row.webhookId, row.status, row.attempts]), [["wh1", "pending", 0], ["wh2", "pending", 0]]);
	assert.deepEqual(
		fixture.queued.map(({ body }) => body).sort((a, b) => a.deliveryId.localeCompare(b.deliveryId)),
		rows.map((row) => ({ kind: "webhook.retry", deliveryId: row.id })).sort((a, b) => a.deliveryId.localeCompare(b.deliveryId)),
	);
	assert.ok(fixture.queued.every(({ options }) => !options?.delaySeconds), "the first attempt is not delayed");
});

test("the queue consumer delivers a queued attempt and skips it once settled", async (t) => {
	const fixture = await createFixture(t);
	fixture.addHook("wh1", ["message.inbound"]);
	const calls = mockFetch(t);
	await dispatchWebhooks(fixture.env, "u1", "message.inbound", { messageId: "m1" });
	const [message] = fixture.queued;

	await processWebhookRetry(fixture.env, message.body);
	assert.equal(calls.length, 1);
	assert.equal(calls[0].headers["X-Email-Platform-Attempt"], "1");
	assert.deepEqual(fixture.deliveries().map((row) => [row.status, row.attempts]), [["delivered", 1]]);

	// A redelivered queue message must not post again; the manual retry still can.
	await processWebhookRetry(fixture.env, message.body);
	assert.equal(calls.length, 1);
	await runDelivery(fixture.env, message.body.deliveryId);
	assert.equal(calls.length, 2);
});

test("a failed first attempt schedules a delayed retry on the queue", async (t) => {
	const fixture = await createFixture(t);
	fixture.addHook("wh1", ["message.inbound"]);
	mockFetch(t, 500);
	await dispatchWebhooks(fixture.env, "u1", "message.inbound", { messageId: "m1" });
	await processWebhookRetry(fixture.env, fixture.queued[0].body);

	assert.deepEqual(fixture.deliveries().map((row) => [row.status, row.attempts]), [["retrying", 1]]);
	assert.equal(fixture.queued.length, 2);
	assert.equal(fixture.queued[1].options.delaySeconds, 60);
});

test("when the queue refuses the work, dispatch delivers inline as before", async (t) => {
	t.mock.method(console, "error", () => undefined);
	const fixture = await createFixture(t, { queueFails: true });
	fixture.addHook("wh1", ["message.outbound"]);
	const calls = mockFetch(t);

	await dispatchWebhooks(fixture.env, "u1", "message.outbound", { messageId: "m1" });

	assert.equal(calls.length, 1);
	assert.deepEqual(fixture.deliveries().map((row) => [row.status, row.attempts]), [["delivered", 1]]);
});

test("no subscribed hook means no rows and no queue messages", async (t) => {
	const fixture = await createFixture(t);
	fixture.addHook("wh1", ["message.outbound"]);
	await dispatchWebhooks(fixture.env, "u1", "message.inbound", { messageId: "m1" });
	assert.deepEqual(fixture.deliveries(), []);
	assert.deepEqual(fixture.queued, []);
});
