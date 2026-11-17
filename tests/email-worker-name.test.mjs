import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

// Email Routing rules target CF_EMAIL_WORKER_NAME when it is set, and "mailclaw" otherwise.

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(root, "tests", ".tmp-worker-name-"));
after(() => rmSync(outDir, { recursive: true, force: true }));

await build({
	stdin: {
		contents: `export { getEmailWorkerName } from "./src/lib/cloudflare-api-utils"; export { ensureEmailRoutingRuleToWorker, deleteEmailRoutingRuleForAddress } from "./src/lib/cloudflare-api"; export { ensureEmailRoutingCatchAllToWorker } from "./src/lib/domains/catch-all-routing";`,
		resolveDir: root,
		loader: "ts",
	},
	outfile: join(outDir, "entry.mjs"),
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node22",
	logLevel: "silent",
	alias: { "@": join(root, "src") },
});
const lib = await import(pathToFileURL(join(outDir, "entry.mjs")).href);

test("getEmailWorkerName reads CF_EMAIL_WORKER_NAME, trimmed, with mailclaw as the fallback", () => {
	assert.equal(lib.getEmailWorkerName({}), "mailclaw");
	assert.equal(lib.getEmailWorkerName({ CF_EMAIL_WORKER_NAME: "" }), "mailclaw");
	assert.equal(lib.getEmailWorkerName({ CF_EMAIL_WORKER_NAME: "   " }), "mailclaw");
	assert.equal(lib.getEmailWorkerName({ CF_EMAIL_WORKER_NAME: " mail-prod \n" }), "mail-prod");
});

function stubCloudflare(t, rules = []) {
	const calls = [];
	const original = globalThis.fetch;
	globalThis.fetch = async (input, init = {}) => {
		const url = new URL(typeof input === "string" ? input : input.href ?? input.url);
		const method = init.method ?? "GET";
		calls.push({ method, path: url.pathname, body: init.body ? JSON.parse(init.body) : undefined });
		const result = method === "GET" ? rules : { id: "new-rule" };
		return Response.json({ success: true, result, errors: [] });
	};
	t.after(() => { globalThis.fetch = original; });
	return calls;
}

test("routing rules and the catch-all target the configured Worker", async (t) => {
	const env = { CF_TOKEN: "token", CF_EMAIL_WORKER_NAME: "mail-prod" };
	const calls = stubCloudflare(t, [
		{ id: "old", enabled: true, matchers: [{ type: "literal", field: "to", value: "a@example.test" }], actions: [{ type: "worker", value: ["mailclaw"] }] },
	]);
	// A rule to another Worker does not count as this Worker's route, so a new one is created.
	await lib.ensureEmailRoutingRuleToWorker(env, "zone", "A@example.test");
	const created = calls.find((call) => call.method === "POST");
	assert.deepEqual(created.body.actions, [{ type: "worker", value: ["mail-prod"] }]);
	assert.equal(created.body.name, "Route a@example.test to mail-prod");

	await lib.ensureEmailRoutingCatchAllToWorker(env, "zone");
	assert.deepEqual(calls.at(-1).body.actions, [{ type: "worker", value: ["mail-prod"] }]);
	assert.equal(await lib.deleteEmailRoutingRuleForAddress(env, "zone", "a@example.test"), false);
});

test("without the variable, rules keep targeting mailclaw", async (t) => {
	const calls = stubCloudflare(t, [
		{ id: "old", enabled: true, matchers: [{ type: "literal", field: "to", value: "a@example.test" }], actions: [{ type: "worker", value: ["mailclaw"] }] },
	]);
	const existing = await lib.ensureEmailRoutingRuleToWorker({ CF_TOKEN: "token" }, "zone", "a@example.test");
	assert.equal(existing.id, "old");
	assert.equal(calls.filter((call) => call.method !== "GET").length, 0);
	assert.equal(await lib.deleteEmailRoutingRuleForAddress({ CF_TOKEN: "token" }, "zone", "a@example.test"), true);
	assert.equal(calls.at(-1).method, "DELETE");
});
