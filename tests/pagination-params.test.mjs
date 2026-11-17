import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(join(tmpdir(), "mailclaw-pagination-test-"));
after(() => rmSync(dir, { recursive: true, force: true }));

await build({
	entryPoints: [join(root, "src/lib/http/pagination.ts")],
	outfile: join(dir, "pagination.mjs"), bundle: true, platform: "node", format: "esm", logLevel: "silent",
});
const { clampIntParam } = await import(pathToFileURL(join(dir, "pagination.mjs")).href);

test("a missing, empty or non-numeric parameter gives the fallback", () => {
	assert.equal(clampIntParam(null, 50, 1, 100), 50);
	assert.equal(clampIntParam("", 50, 1, 100), 50);
	assert.equal(clampIntParam("  ", 50, 1, 100), 50);
	assert.equal(clampIntParam("abc", 50, 1, 100), 50);
	assert.equal(clampIntParam("Infinity", 50, 1, 100), 50);
});

test("a negative limit never reaches the database as LIMIT -1", () => {
	assert.equal(clampIntParam("-1", 50, 1, 100), 1);
	assert.equal(clampIntParam("0", 50, 1, 100), 1);
	assert.equal(clampIntParam("-5", 0, 0, Number.MAX_SAFE_INTEGER), 0);
});

test("values are truncated and capped at the maximum", () => {
	assert.equal(clampIntParam("25", 50, 1, 100), 25);
	assert.equal(clampIntParam("25.9", 50, 1, 100), 25);
	assert.equal(clampIntParam("1000", 50, 1, 100), 100);
});
