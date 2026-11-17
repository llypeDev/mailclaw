import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

// sweepRawObjects (src/lib/email/raw-sweeper-utils.ts): the orphaned raw MIME sweep keeps its listing
// cursor in the bucket so successive runs cover the whole `inbound/` prefix, and it leaves anything
// younger than the queue + dead-letter retention alone.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(root, "tests", ".tmp-raw-sweeper-"));
after(() => rmSync(outDir, { recursive: true, force: true }));

await build({
	entryPoints: { sweeper: join(root, "src/lib/email/raw-sweeper-utils.ts") },
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

const {
	sweepRawObjects,
	parseRawSweepState,
	RAW_SWEEP_STATE_KEY,
	RAW_SWEEP_MIN_AGE_MS,
	RAW_SWEEP_PAGE,
	RAW_SWEEP_MAX_PAGES,
} = await import(pathToFileURL(join(outDir, "sweeper.mjs")).href);

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-11-16T02:00:00Z");

/** An in-memory bucket with R2's list semantics (sorted keys, cursor = an opaque resume token). */
function fakeBucket() {
	const objects = new Map();
	const calls = { list: [], puts: 0 };
	return {
		objects,
		calls,
		add(key, uploaded) {
			objects.set(key, { key, uploaded, body: "" });
		},
		async list({ prefix = "", cursor, limit = 1000 }) {
			calls.list.push(cursor ?? null);
			if (cursor === "refused") throw new Error("invalid cursor");
			const keys = [...objects.keys()].filter((key) => key.startsWith(prefix)).sort();
			const after = cursor ? keys.filter((key) => key > Buffer.from(cursor, "base64").toString()) : keys;
			const page = after.slice(0, limit);
			const truncated = after.length > limit;
			return {
				objects: page.map((key) => ({ key, uploaded: objects.get(key).uploaded })),
				truncated,
				cursor: truncated ? Buffer.from(page[page.length - 1]).toString("base64") : undefined,
			};
		},
		async delete(keys) {
			for (const key of [].concat(keys)) objects.delete(key);
		},
		async get(key) {
			const object = objects.get(key);
			return object ? { text: async () => object.body } : null;
		},
		async put(key, value) {
			calls.puts += 1;
			objects.set(key, { key, uploaded: NOW, body: String(value) });
		},
	};
}

const pad = (n) => String(n).padStart(6, "0");
const referencedNone = async () => [];

test("parseRawSweepState accepts only a non-empty string cursor", () => {
	assert.deepEqual(parseRawSweepState(null), { cursor: null });
	assert.deepEqual(parseRawSweepState("not json"), { cursor: null });
	assert.deepEqual(parseRawSweepState(JSON.stringify({ cursor: 5 })), { cursor: null });
	assert.deepEqual(parseRawSweepState(JSON.stringify({ cursor: "" })), { cursor: null });
	assert.deepEqual(parseRawSweepState(JSON.stringify({ cursor: "abc" })), { cursor: "abc" });
});

test("the minimum age outlasts queue retention plus dead-letter retention (14 + 14 days)", () => {
	assert.ok(RAW_SWEEP_MIN_AGE_MS > 28 * DAY);
});

test("successive runs resume from the saved cursor and wrap around at the end", async () => {
	const bucket = fakeBucket();
	const perRun = RAW_SWEEP_PAGE * RAW_SWEEP_MAX_PAGES;
	const total = perRun * 2 + 50;
	for (let i = 0; i < total; i += 1) bucket.add(`inbound/${pad(i)}.eml`, new Date(NOW.getTime() - 40 * DAY));
	// Keep every object referenced, so the listing itself is what is under test.
	const keepAll = async (keys) => keys;

	const first = await sweepRawObjects(bucket, NOW, keepAll);
	assert.equal(first.listed, perRun);
	assert.ok(first.cursor);
	assert.equal(parseRawSweepState(bucket.objects.get(RAW_SWEEP_STATE_KEY).body).cursor, first.cursor);

	const second = await sweepRawObjects(bucket, NOW, keepAll);
	assert.equal(second.listed, perRun);
	assert.equal(bucket.calls.list[RAW_SWEEP_MAX_PAGES], first.cursor, "second run starts at the first run's cursor");

	const third = await sweepRawObjects(bucket, NOW, keepAll);
	assert.equal(third.listed, 50);
	assert.equal(third.cursor, null, "the end of the prefix clears the cursor");

	const fourth = await sweepRawObjects(bucket, NOW, keepAll);
	assert.equal(bucket.calls.list.at(-RAW_SWEEP_MAX_PAGES), null, "the next run starts again from the beginning");
	assert.equal(fourth.listed, perRun);
});

test("only old, unreferenced raw objects are deleted", async () => {
	const bucket = fakeBucket();
	bucket.add("inbound/old-orphan.eml", new Date(NOW.getTime() - 31 * DAY));
	bucket.add("inbound/old-kept.eml", new Date(NOW.getTime() - 31 * DAY));
	bucket.add("inbound/dlq-orphan.eml", new Date(NOW.getTime() - 5 * DAY));
	bucket.add("inbound/new-orphan.eml", new Date(NOW.getTime() - 1 * DAY));
	bucket.add("drafts/other.eml", new Date(NOW.getTime() - 90 * DAY));

	const looked = [];
	const result = await sweepRawObjects(bucket, NOW, async (keys) => {
		looked.push(...keys);
		return keys.filter((key) => key === "inbound/old-kept.eml");
	});

	assert.equal(result.removed, 1);
	assert.deepEqual(looked.sort(), ["inbound/old-kept.eml", "inbound/old-orphan.eml"]);
	assert.ok(!bucket.objects.has("inbound/old-orphan.eml"));
	for (const key of ["inbound/old-kept.eml", "inbound/dlq-orphan.eml", "inbound/new-orphan.eml", "drafts/other.eml"]) {
		assert.ok(bucket.objects.has(key), key);
	}
});

test("a refused cursor is reset so the next run starts over", async (t) => {
	t.mock.method(console, "error", () => undefined);
	const bucket = fakeBucket();
	bucket.add("inbound/a.eml", new Date(NOW.getTime() - 40 * DAY));
	await bucket.put(RAW_SWEEP_STATE_KEY, JSON.stringify({ cursor: "refused" }));

	await assert.rejects(sweepRawObjects(bucket, NOW, referencedNone), /invalid cursor/);
	assert.equal(parseRawSweepState(bucket.objects.get(RAW_SWEEP_STATE_KEY).body).cursor, null);

	const retry = await sweepRawObjects(bucket, NOW, referencedNone);
	assert.equal(retry.removed, 1);
});

test("an unreadable state object starts from the beginning instead of failing", async (t) => {
	t.mock.method(console, "error", () => undefined);
	const bucket = fakeBucket();
	bucket.add("inbound/a.eml", new Date(NOW.getTime() - 40 * DAY));
	bucket.get = async () => {
		throw new Error("store down");
	};
	const result = await sweepRawObjects(bucket, NOW, referencedNone);
	assert.equal(result.removed, 1);
});
