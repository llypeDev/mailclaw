import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

// S3 and Backblaze lower-case `x-amz-meta-*` names; B2Bucket keeps the caller's key spelling
// in one extra entry so customMetadata reads back as R2 and the Node file bucket return it.

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(root, "tests", ".tmp-b2-metadata-"));
after(() => rmSync(outDir, { recursive: true, force: true }));

await build({
	stdin: {
		contents: `export { B2Bucket } from "./src/lib/storage/b2-bucket"; export * from "./src/lib/storage/b2-metadata-utils";`,
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
const { B2Bucket, encodeCustomMetadata, decodeCustomMetadata, METADATA_KEY_CASE_ENTRY, MAX_USER_METADATA_BYTES } = await import(pathToFileURL(join(outDir, "entry.mjs")).href);

/** A fake S3 that stores metadata headers the way S3 does: names lower-cased. */
function stubS3(t) {
	const stored = new Map();
	const sent = [];
	const original = globalThis.fetch;
	const metaOf = (headers = {}) => {
		const meta = {};
		for (const [name, value] of Object.entries(headers)) if (name.toLowerCase().startsWith("x-amz-meta-")) meta[name.toLowerCase()] = value;
		return meta;
	};
	globalThis.fetch = async (input, init = {}) => {
		const url = new URL(typeof input === "string" ? input : input.href ?? input.url);
		const method = init.method ?? "GET";
		if (method === "POST" && url.searchParams.has("uploads")) {
			sent.push(metaOf(init.headers));
			stored.set(url.pathname, metaOf(init.headers));
			return new Response("<InitiateMultipartUploadResult><UploadId>u1</UploadId></InitiateMultipartUploadResult>");
		}
		if (method === "PUT" && url.searchParams.has("partNumber")) return new Response("", { headers: { ETag: '"e1"' } });
		if (method === "POST" && url.searchParams.has("uploadId")) return new Response("<CompleteMultipartUploadResult></CompleteMultipartUploadResult>");
		if (method === "PUT") {
			sent.push(metaOf(init.headers));
			stored.set(url.pathname, metaOf(init.headers));
			return new Response("", { headers: { ETag: '"abc"' } });
		}
		return new Response(method === "HEAD" ? null : "body", { headers: { "Content-Length": "4", ETag: '"abc"', ...(stored.get(url.pathname) ?? {}) } });
	};
	t.after(() => { globalThis.fetch = original; });
	return { stored, sent };
}

const bucket = () => new B2Bucket({ keyId: "k", applicationKey: "s", bucket: "mail", endpoint: "s3.us-west-004.backblazeb2.com", region: "us-west-004" });

test("customMetadata keys keep their case through put/get, head and multipart", async (t) => {
	const { sent } = stubS3(t);
	const b2 = bucket();
	await b2.put("attachments/a", "x", { customMetadata: { filename: "a.pdf", messageId: "m1" } });
	assert.deepEqual(sent[0], { "x-amz-meta-filename": "a.pdf", "x-amz-meta-messageid": "m1", [`x-amz-meta-${METADATA_KEY_CASE_ENTRY}`]: "messageId" });
	assert.deepEqual((await b2.get("attachments/a")).customMetadata, { filename: "a.pdf", messageId: "m1" });
	assert.deepEqual((await b2.head("attachments/a")).customMetadata, { filename: "a.pdf", messageId: "m1" });

	const upload = await b2.createMultipartUpload("jmap-uploads/b", { customMetadata: { userId: "u1", name: "b.eml" } });
	await upload.complete([await upload.uploadPart(1, new Uint8Array([1]))]);
	assert.deepEqual((await b2.head("jmap-uploads/b")).customMetadata, { userId: "u1", name: "b.eml" });
});

test("all-lower-case keys add no extra entry", async (t) => {
	const { sent } = stubS3(t);
	const b2 = bucket();
	await b2.put("raw/a.eml", "x", { customMetadata: { from: "a@b.example", to: "c@d.example" } });
	assert.deepEqual(sent[0], { "x-amz-meta-from": "a@b.example", "x-amz-meta-to": "c@d.example" });
	assert.deepEqual((await b2.get("raw/a.eml")).customMetadata, { from: "a@b.example", to: "c@d.example" });
	await b2.put("raw/b.eml", "x");
	assert.deepEqual(sent[1], {});
	assert.deepEqual((await b2.get("raw/b.eml")).customMetadata, {});
});

test("objects written before the spelling entry read back lower-cased, as they always did", async (t) => {
	const { stored } = stubS3(t);
	stored.set("/attachments/old", { "x-amz-meta-filename": "old.pdf", "x-amz-meta-messageid": "m0" });
	assert.deepEqual((await bucket().get("attachments/old")).customMetadata, { filename: "old.pdf", messageid: "m0" });
	assert.deepEqual(decodeCustomMetadata({ userid: "u", name: "n" }), { userid: "u", name: "n" });
});

test("the spelling entry is left out when it would push metadata past S3's 2 KB", () => {
	const nearlyFull = { messageId: "m".repeat(MAX_USER_METADATA_BYTES - "messageid".length - 4) };
	const encoded = encodeCustomMetadata(nearlyFull);
	assert.equal(encoded[METADATA_KEY_CASE_ENTRY], undefined);
	assert.deepEqual(Object.keys(encoded), ["messageid"]);
	assert.deepEqual(Object.keys(decodeCustomMetadata(encoded)), ["messageid"]);

	const roomy = encodeCustomMetadata({ messageId: "m" });
	assert.equal(roomy[METADATA_KEY_CASE_ENTRY], "messageId");
});

test("keys differing only by case collapse to the last one, with its spelling", () => {
	const encoded = encodeCustomMetadata({ MessageId: "first", messageId: "second" });
	assert.deepEqual(encoded, { messageid: "second", [METADATA_KEY_CASE_ENTRY]: "messageId" });
	assert.deepEqual(decodeCustomMetadata(encoded), { messageId: "second" });
});

test("a caller key named like the spelling entry is kept, and a stray list is not trusted", () => {
	const encoded = encodeCustomMetadata({ [METADATA_KEY_CASE_ENTRY]: "mine", userId: "u" });
	assert.deepEqual(encoded, { [METADATA_KEY_CASE_ENTRY]: "mine", userid: "u" });
	assert.deepEqual(decodeCustomMetadata(encoded), { [METADATA_KEY_CASE_ENTRY]: "mine", userid: "u" });
	// A list naming a key that is not present is ignored rather than half-applied.
	assert.deepEqual(decodeCustomMetadata({ userid: "u", [METADATA_KEY_CASE_ENTRY]: "userId,ghostKey" }), { userid: "u", [METADATA_KEY_CASE_ENTRY]: "userId,ghostKey" });
});
