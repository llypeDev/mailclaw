import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

// Every buffered B2/S3 call carries a deadline; the object GET does not, because downloads
// stream through it for as long as they take. Also: custom metadata survives the round trip.

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(root, "tests", ".tmp-b2-timeouts-"));
after(() => rmSync(outDir, { recursive: true, force: true }));

await build({
	stdin: {
		contents: `export { B2Bucket } from "./src/lib/storage/b2-bucket"; export * from "./src/lib/email/intake-utils";`,
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
const { B2Bucket, inboundTraceMetadata, readInboundTraceMetadata } = await import(pathToFileURL(join(outDir, "entry.mjs")).href);

function stubFetch(t) {
	const calls = [];
	const stored = new Map();
	const original = globalThis.fetch;
	globalThis.fetch = async (input, init = {}) => {
		const url = new URL(typeof input === "string" ? input : input.href ?? input.url);
		const method = init.method ?? "GET";
		const label = `${method}${url.searchParams.has("uploads") ? " create" : url.searchParams.has("partNumber") ? " part" : url.searchParams.has("uploadId") ? " upload" : url.searchParams.has("list-type") ? " list" : ""}`;
		calls.push({ label, signal: init.signal });
		if (label === "POST create") return new Response("<InitiateMultipartUploadResult><UploadId>u1</UploadId></InitiateMultipartUploadResult>");
		if (label === "PUT part") return new Response("", { headers: { ETag: '"e1"' } });
		if (label === "POST upload") return new Response("<CompleteMultipartUploadResult></CompleteMultipartUploadResult>");
		if (label === "GET list") return new Response("<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>");
		if (method === "PUT") {
			const meta = {};
			for (const [name, value] of Object.entries(init.headers ?? {})) if (name.toLowerCase().startsWith("x-amz-meta-")) meta[name.toLowerCase()] = value;
			stored.set(url.pathname, meta);
			return new Response("", { headers: { ETag: '"abc"' } });
		}
		if (method === "DELETE") return new Response(null, { status: 204 });
		return new Response(method === "HEAD" ? null : "body", { headers: { "Content-Length": "4", ETag: '"abc"', ...(stored.get(url.pathname) ?? {}) } });
	};
	t.after(() => { globalThis.fetch = original; });
	return calls;
}

const bucket = () => new B2Bucket({ keyId: "k", applicationKey: "s", bucket: "mail", endpoint: "s3.us-west-004.backblazeb2.com", region: "us-west-004" });

test("head, put, delete, list and multipart calls carry a deadline; the object GET does not", async (t) => {
	const calls = stubFetch(t);
	const b2 = bucket();
	await b2.put("raw/a.eml", "hello");
	await b2.head("raw/a.eml");
	await b2.delete("raw/a.eml");
	await b2.list({ prefix: "raw/" });
	const upload = await b2.createMultipartUpload("drive/big");
	const part = await upload.uploadPart(1, new Uint8Array([1, 2, 3]));
	await upload.complete([part]);
	await upload.abort();
	const object = await b2.get("raw/a.eml");
	assert.equal(await object.text(), "body");
	await b2.get("raw/a.eml", { range: { offset: 0, length: 2 } });

	const byLabel = (label) => calls.filter((call) => call.label === label);
	for (const label of ["PUT", "HEAD", "DELETE", "GET list", "POST create", "PUT part", "POST upload", "DELETE upload"]) {
		assert.ok(byLabel(label).length > 0, `${label} was called`);
		for (const call of byLabel(label)) assert.ok(call.signal instanceof AbortSignal, `${label} has a deadline`);
	}
	assert.equal(byLabel("GET").length, 2);
	for (const call of byLabel("GET")) assert.equal(call.signal, undefined, "the streaming GET has no deadline");
});

test("a deadline that passes surfaces as an AwsError, which callers already handle", async (t) => {
	const original = globalThis.fetch;
	globalThis.fetch = async () => { throw new DOMException("The operation timed out.", "TimeoutError"); };
	t.after(() => { globalThis.fetch = original; });
	await assert.rejects(bucket().head("raw/a.eml"), (error) => error.code === "RequestTimeout" && error.status === 504);
});

test("inbound trace metadata round-trips through B2, whose metadata headers come back lower-cased", async (t) => {
	stubFetch(t);
	const b2 = bucket();
	const trace = inboundTraceMetadata({ verdicts: { spf: "PASS", dkim: "FAIL" }, senderIp: "203.0.113.7" });
	await b2.put("inbound/x.eml", "raw", { customMetadata: { from: "a@b.example", to: "c@d.example", ...trace } });
	const object = await b2.get("inbound/x.eml", { range: { offset: 0, length: 64 } });
	assert.equal(object.customMetadata.to, "c@d.example");
	assert.deepEqual(readInboundTraceMetadata(object.customMetadata), { verdicts: { spf: "PASS", dkim: "FAIL" }, senderIp: "203.0.113.7" });
});
