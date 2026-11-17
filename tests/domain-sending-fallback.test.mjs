import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import test, { after, beforeEach } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

// Cloudflare refuses Email Sending with 401/2036 on the free plan. Provisioning must
// then finish the domain receive-only instead of failing (which, on first run, also
// throws away the account being created), and report why.

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(root, "tests", ".tmp-domain-sending-fallback-"));
after(() => rmSync(outDir, { recursive: true, force: true }));

const mocks = {
	"@/lib/cloudflare-api": [
		"export async function findZoneByHostname(){return {id:'zone-1',name:'example.com'};}",
		"export async function getEmailRoutingSettings(){return {enabled:false};}",
		"export async function enableEmailRouting(){return {enabled:true,status:'ready'};}",
		"export async function listSendingSubdomains(){return [];}",
		"export async function createSendingSubdomain(){if(globalThis.__sendingError)throw globalThis.__sendingError;return {tag:'tag-1',name:'example.com',enabled:true};}",
	].join(""),
	"@/lib/domains/catch-all-routing": "export async function ensureEmailRoutingCatchAllToWorker(){}export async function getEmailRoutingCatchAll(){return null;}",
	"@/lib/domains/mx-records": "export async function removeMxRecords(){}export async function listConflictingMxRecords(){return globalThis.__foreignMx;}",
	"@/lib/domains/rollback": "export async function rollbackDomainProvisioning(){globalThis.__rolledBack=true;}",
	"@/lib/domains/receiving-dns": "export class MxConflictError extends Error{constructor(records,message){super(message);this.records=records;}}",
};

await build({
	stdin: {
		contents: "export { provisionDomainOnCloudflare } from './src/lib/domains/provision';export { CloudflareApiError } from './src/lib/cloudflare-api-error';export { isSendingAuthorizationError } from './src/lib/domains/sending-subdomain';",
		resolveDir: root,
		loader: "ts",
	},
	outfile: join(outDir, "provision.mjs"),
	bundle: true,
	platform: "node",
	format: "esm",
	packages: "external",
	alias: { "@": join(root, "src") },
	plugins: [{
		name: "mock-domain-deps",
		setup(builder) {
			const names = Object.keys(mocks).map((name) => name.replace(/[/.-]/g, "\\$&")).join("|");
			builder.onResolve({ filter: new RegExp(`^(${names})$`) }, (args) => ({ path: args.path, namespace: "mock" }));
			builder.onLoad({ filter: /.*/, namespace: "mock" }, (args) => ({ contents: mocks[args.path], loader: "js" }));
		},
	}],
	logLevel: "silent",
});

const lib = await import(pathToFileURL(join(outDir, "provision.mjs")).href);
const env = { CF_TOKEN: "token" };
const freePlanError = () => new lib.CloudflareApiError("Cloudflare API 401: code 2036: Unauthorized", 401, "/zones/zone-1/email/sending/subdomains", [{ code: 2036, message: "Unauthorized" }]);

beforeEach(() => {
	globalThis.__sendingError = null;
	globalThis.__foreignMx = [];
	globalThis.__rolledBack = false;
});

test("sending refused for authorization leaves a receive-only domain", async () => {
	globalThis.__sendingError = freePlanError();
	const warn = console.warn;
	console.warn = () => {};
	let result;
	try {
		result = await lib.provisionDomainOnCloudflare(env, "example.com", { enableRouting: true, enableSending: true });
	} finally {
		console.warn = warn;
	}
	assert.equal(result.routingEnabled, true);
	assert.equal(result.sendingEnabled, false);
	assert.equal(result.sendingRequested, false);
	assert.equal(result.sendingUnavailable.reason, "unauthorized");
	assert.match(result.sendingUnavailable.message, /2036/);
	assert.equal(globalThis.__rolledBack, false);
});

test("sending that works is unchanged", async () => {
	const result = await lib.provisionDomainOnCloudflare(env, "example.com", { enableRouting: true, enableSending: true });
	assert.equal(result.sendingEnabled, true);
	assert.equal(result.sendingRequested, true);
	assert.equal("sendingUnavailable" in result, false);
});

test("without routing there is nothing to fall back to, so the error stands", async () => {
	globalThis.__sendingError = freePlanError();
	await assert.rejects(lib.provisionDomainOnCloudflare(env, "example.com", { enableRouting: false, enableSending: true }), /2036/);
	assert.equal(globalThis.__rolledBack, true);
});

test("foreign MX records still ask for consent instead of falling back", async () => {
	globalThis.__sendingError = freePlanError();
	globalThis.__foreignMx = [{ content: "mx.other.example", priority: 10 }];
	await assert.rejects(lib.provisionDomainOnCloudflare(env, "example.com", { enableRouting: true, enableSending: true }), /MX records for another mail service/);
});

test("other Cloudflare failures still abort provisioning", async () => {
	globalThis.__sendingError = new lib.CloudflareApiError("Cloudflare API 500", 500, "/x", []);
	await assert.rejects(lib.provisionDomainOnCloudflare(env, "example.com", { enableRouting: true, enableSending: true }), /500/);
	assert.equal(globalThis.__rolledBack, true);
	assert.equal(lib.isSendingAuthorizationError(new lib.CloudflareApiError("forbidden", 403, "/x", [])), true);
	assert.equal(lib.isSendingAuthorizationError(new Error("401")), false);
});
