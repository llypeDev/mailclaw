import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

// The queue consumer's retry policy (src/lib/queues/retry-utils.ts) and the consumer settings in
// wrangler.jsonc / wrangler.jsonc.example must agree: max_retries, dead-letter queues, batch size.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(root, "tests", ".tmp-queue-retry-policy-"));
after(() => rmSync(outDir, { recursive: true, force: true }));

await build({
	entryPoints: { retry: join(root, "src/lib/queues/retry-utils.ts"), utils: join(root, "worker-utils.ts") },
	outdir: outDir,
	outExtension: { ".js": ".mjs" },
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node22",
	tsconfig: join(root, "tsconfig.json"),
	packages: "external",
	logLevel: "silent",
});

const { queueRetryDelaySeconds, isFinalQueueAttempt, QUEUE_MAX_RETRIES, QUEUE_DEAD_LETTER, MAX_RETRY_DELAY_SECONDS } = await import(
	pathToFileURL(join(outDir, "retry.mjs")).href
);
const { queueKindOf, isAgentDraftMessage } = await import(pathToFileURL(join(outDir, "utils.mjs")).href);

/** Strip // comments and trailing commas: enough JSONC for these files. */
function readJsonc(path) {
	const text = readFileSync(path, "utf8");
	let out = "";
	let inString = false;
	for (let i = 0; i < text.length; i += 1) {
		const ch = text[i];
		if (inString) {
			out += ch;
			if (ch === "\\") out += text[++i];
			else if (ch === '"') inString = false;
		} else if (ch === '"') {
			inString = true;
			out += ch;
		} else if (ch === "/" && text[i + 1] === "/") {
			while (i < text.length && text[i] !== "\n") i += 1;
			out += "\n";
		} else {
			out += ch;
		}
	}
	return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

test("retry delay grows from 10 s by a factor of three and is capped at 15 minutes", () => {
	assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map(queueRetryDelaySeconds), [10, 30, 90, 270, 810, 900, 900]);
	assert.equal(MAX_RETRY_DELAY_SECONDS, 900);
});

test("retry delay tolerates odd attempt counts", () => {
	assert.equal(queueRetryDelaySeconds(0), 10);
	assert.equal(queueRetryDelaySeconds(-3), 10);
	assert.equal(queueRetryDelaySeconds(Number.NaN), 10);
	assert.equal(queueRetryDelaySeconds(2.7), 30);
	assert.equal(queueRetryDelaySeconds(1_000_000), 900);
});

test("all retries of an inbound or outbound message fit inside the import stale window (30 min)", () => {
	for (const kind of ["inbound", "outbound"]) {
		let total = 0;
		for (let attempts = 1; attempts <= QUEUE_MAX_RETRIES[kind]; attempts += 1) total += queueRetryDelaySeconds(attempts);
		assert.ok(total < 30 * 60, `${kind}: ${total} s`);
	}
});

test("the final attempt is the one after max_retries retries", () => {
	assert.equal(isFinalQueueAttempt("inbound", 5), false);
	assert.equal(isFinalQueueAttempt("inbound", 6), true);
	assert.equal(isFinalQueueAttempt("agent", 3), false);
	assert.equal(isFinalQueueAttempt("agent", 4), true);
});

test("queueKindOf tells the three consumers apart by message body", () => {
	assert.equal(queueKindOf({ from: "a@example.com", to: "b@example.com", rawR2Key: "inbound/x.eml" }), "inbound");
	assert.equal(queueKindOf({ kind: "agent.draft", jobId: "job" }), "agent");
	assert.equal(queueKindOf({ kind: "webhook.retry", deliveryId: "whd" }), "outbound");
	assert.equal(queueKindOf({ kind: "import.run", jobId: "imp" }), "outbound");
	assert.equal(queueKindOf({ kind: "email.scheduled", jobId: "job" }), "outbound");
	assert.equal(queueKindOf(null), "outbound");
	assert.equal(isAgentDraftMessage({ kind: "agent.draft" }), false);
});

for (const file of ["wrangler.jsonc", "wrangler.jsonc.example"]) {
	test(`${file} consumers match the retry policy`, () => {
		const config = readJsonc(join(root, file));
		const consumers = Object.fromEntries(config.queues.consumers.map((consumer) => [consumer.queue, consumer]));
		const byKind = { inbound: consumers["mailclaw-inbound"], outbound: consumers["mailclaw-outbound"], agent: consumers["mailclaw-agent"] };
		for (const [kind, consumer] of Object.entries(byKind)) {
			assert.ok(consumer, `${file}: consumer for ${kind}`);
			assert.equal(consumer.max_retries, QUEUE_MAX_RETRIES[kind], `${file}: ${kind} max_retries`);
			assert.equal(consumer.dead_letter_queue ?? null, QUEUE_DEAD_LETTER[kind], `${file}: ${kind} dead_letter_queue`);
		}
		assert.equal(byKind.inbound.max_batch_size, 1);
		assert.equal(byKind.outbound.max_batch_size, 1);
		// A dead-letter queue must never be one of the live queues, or failures would loop back in.
		const live = new Set(config.queues.producers.map((producer) => producer.queue));
		for (const name of Object.values(QUEUE_DEAD_LETTER)) if (name) assert.ok(!live.has(name));
	});

	test(`${file} sets workers_dev, preview_urls and smart placement explicitly`, () => {
		const config = readJsonc(join(root, file));
		assert.equal(config.workers_dev, true);
		assert.equal(config.preview_urls, false);
		assert.deepEqual(config.placement, { mode: "smart" });
	});
}
