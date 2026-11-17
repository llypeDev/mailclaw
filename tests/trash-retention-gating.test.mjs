import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

// Trash retention runs hourly: on Workers on the five-minute cron tick at minute 0, in the Node
// scheduler on the first tick of each UTC hour (src/lib/email/trash-retention-utils.ts).
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(root, "tests", ".tmp-trash-gating-"));
after(() => rmSync(outDir, { recursive: true, force: true }));

await build({
	entryPoints: { utils: join(root, "src/lib/email/trash-retention-utils.ts") },
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

const { shouldRunTrashRetention, trashRetentionHourKey, FREQUENT_CRON } = await import(pathToFileURL(join(outDir, "utils.mjs")).href);

test("runs on the five-minute tick at minute 0 only", () => {
	assert.equal(FREQUENT_CRON, "*/5 * * * *");
	assert.equal(shouldRunTrashRetention(FREQUENT_CRON, Date.parse("2026-11-16T13:00:00Z")), true);
	assert.equal(shouldRunTrashRetention(FREQUENT_CRON, new Date("2026-11-16T13:00:00Z")), true);
	for (const minute of ["05", "30", "55"]) {
		assert.equal(shouldRunTrashRetention(FREQUENT_CRON, Date.parse(`2026-11-16T13:${minute}:00Z`)), false, minute);
	}
});

test("the daily 02:00 trigger does not run it a second time", () => {
	assert.equal(shouldRunTrashRetention("0 2 * * *", Date.parse("2026-11-16T02:00:00Z")), false);
	assert.equal(shouldRunTrashRetention(FREQUENT_CRON, Date.parse("2026-11-16T02:00:00Z")), true);
});

test("runs 24 times a day on the five-minute trigger", () => {
	const start = Date.parse("2026-11-16T00:00:00Z");
	let runs = 0;
	for (let tick = 0; tick < 288; tick += 1) if (shouldRunTrashRetention(FREQUENT_CRON, start + tick * 5 * 60 * 1000)) runs += 1;
	assert.equal(runs, 24);
});

test("the Node hour key changes once per UTC hour, even when a drifting timer skips minute 0", () => {
	assert.equal(trashRetentionHourKey(new Date("2026-11-16T13:59:59Z")), "2026-11-16T13");
	assert.equal(trashRetentionHourKey(new Date("2026-11-16T14:01:30Z")), "2026-11-16T14");
	// A minute timer that drifted: 13:58:40, 13:59:41, 14:00:42 ... still one run per hour.
	let last = "";
	let runs = 0;
	for (let tick = 0; tick < 120; tick += 1) {
		const key = trashRetentionHourKey(new Date(Date.parse("2026-11-16T12:58:40Z") + tick * 61_000));
		if (key !== last) {
			last = key;
			runs += 1;
		}
	}
	assert.equal(runs, 3);
});
