import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

// The receiving side's verdicts and sender IP ride with the stored raw object, so inbound mail the
// Node runtime re-enqueues after a restart keeps its authentication signals; and the provider
// intake checks attachment limits with the linear scan, never a full MIME parse.

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(root, "tests", ".tmp-intake-trace-"));
after(() => rmSync(outDir, { recursive: true, force: true }));

const mocks = {
	"@/db": `export const getDb = () => globalThis.__testDb;`,
	"@/lib/email/account-forwarding": `
		export const MAILCLAW_FORWARDED_HEADER = "X-Mailclaw-Forwarded";
		export const isForwardedMarkerValid = async () => false;
		export const forwardedMarker = async () => "marker";
		export const getAccountForwardingDestination = async () => null;`,
	"@/lib/email/incoming": `export const resolveIncomingMail = async () => globalThis.__decision ?? null;`,
	"@/lib/email/parse": `
		export * from ${JSON.stringify(join(root, "src/lib/email/parse.ts"))};
		export async function parseRawMime() { globalThis.__parseCalls = (globalThis.__parseCalls ?? 0) + 1; throw new Error("the intake must not parse"); }`,
};

await build({
	stdin: {
		contents: [
			`export * from "./src/lib/email/intake-utils";`,
			`export { intakeIncomingMail } from "./src/lib/email/intake";`,
			`export { intakeProviderMail } from "./src/lib/email/provider-intake";`,
			`export { recoverPayload } from "./server/runtime/inbound-recovery";`,
			`export { FileBucket } from "./server/runtime/file-bucket";`,
		].join("\n"),
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
	plugins: [{
		name: "mocks",
		setup(builder) {
			builder.onResolve({ filter: /^@\/(db|lib\/email\/account-forwarding|lib\/email\/incoming|lib\/email\/parse)$/ }, (args) => ({ path: args.path, namespace: "mock" }));
			builder.onLoad({ filter: /.*/, namespace: "mock" }, (args) => ({ contents: mocks[args.path], loader: "ts", resolveDir: root }));
		},
	}],
});

const lib = await import(pathToFileURL(join(outDir, "entry.mjs")).href);
const encoder = new TextEncoder();
const raw = encoder.encode("From: a@sender.example\r\nTo: b@mail.example\r\nAuthentication-Results: forged; spf=pass\r\nSubject: hi\r\n\r\nhello\r\n").buffer;

test("trace metadata keeps known verdicts and a plausible IP, small and lower-case", () => {
	const metadata = lib.inboundTraceMetadata({ verdicts: { spf: "PASS", dkim: "FAIL", dmarc: "PASS", spam: "PASS", virus: "PASS" }, senderIp: "203.0.113.7" });
	assert.deepEqual(Object.keys(metadata).sort(), ["sender-ip", "verdicts"]);
	assert.ok(metadata.verdicts.length < 200);
	assert.deepEqual(lib.readInboundTraceMetadata(metadata), { verdicts: { spf: "PASS", dkim: "FAIL", dmarc: "PASS", spam: "PASS", virus: "PASS" }, senderIp: "203.0.113.7" });
	assert.equal(lib.readInboundTraceMetadata({ "sender-ip": "2001:db8::1" }).senderIp, "2001:db8::1");

	// Unknown keys, oversized or odd values and header-breaking characters never reach the metadata.
	const hostile = lib.inboundTraceMetadata({ verdicts: { spf: "PASS\r\nX: y", dkim: "A".repeat(100), other: "PASS", dmarc: "PASS" }, senderIp: "evil\r\nhost" });
	assert.deepEqual(hostile, { verdicts: JSON.stringify({ dmarc: "PASS" }) });
	assert.deepEqual(lib.inboundTraceMetadata({}), {});
	assert.deepEqual(lib.readInboundTraceMetadata({ verdicts: "{not json", "sender-ip": "x".repeat(60) }), {});
	assert.deepEqual(lib.readInboundTraceMetadata({ verdicts: JSON.stringify({ spf: "PASS\nX" }) }), {});
	assert.deepEqual(lib.readInboundTraceMetadata(undefined), {});
});

test("intake stores verdicts and sender IP with the raw object, beside the envelope", async () => {
	const puts = [];
	const sent = [];
	const env = {
		BUCKET: { put: async (key, value, options) => puts.push({ key, options }) },
		INBOUND_QUEUE: { send: async (payload) => sent.push(payload) },
	};
	globalThis.__decision = { action: "store", mailbox: { mailboxId: "mb1" } };
	const result = await lib.intakeIncomingMail(env, { from: "a@sender.example", to: "b@mail.example", raw, headers: {}, verdicts: { spf: "PASS", dkim: "PASS" }, senderIp: "198.51.100.4" }, {});
	assert.equal(result.action, "store");
	assert.deepEqual(puts[0].options.customMetadata, {
		from: "a@sender.example",
		to: "b@mail.example",
		verdicts: JSON.stringify({ spf: "PASS", dkim: "PASS" }),
		"sender-ip": "198.51.100.4",
	});
	assert.deepEqual(sent[0].verdicts, { spf: "PASS", dkim: "PASS" });

	// Without verdicts only the envelope is stored, as before.
	await lib.intakeIncomingMail(env, { from: "a@sender.example", to: "b@mail.example", raw, headers: {} }, {});
	assert.deepEqual(puts[1].options.customMetadata, { from: "a@sender.example", to: "b@mail.example" });
	delete globalThis.__decision;
});

test("recovery reads the stored verdicts back from a file bucket and drops forged headers", async () => {
	const bucket = new lib.FileBucket(join(outDir, "bucket"));
	await bucket.put("inbound/abc.eml", raw, {
		httpMetadata: { contentType: "message/rfc822" },
		customMetadata: { from: "a@sender.example", to: "b@mail.example", ...lib.inboundTraceMetadata({ verdicts: { spf: "PASS", dmarc: "FAIL" }, senderIp: "192.0.2.9" }) },
	});
	const payload = await lib.recoverPayload({ BUCKET: bucket }, "inbound/abc.eml");
	assert.equal(payload.to, "b@mail.example");
	assert.equal(payload.from, "a@sender.example");
	assert.deepEqual(payload.verdicts, { spf: "PASS", dmarc: "FAIL" });
	assert.equal(payload.senderIp, "192.0.2.9");
	assert.equal(payload.headers.subject, "hi");
	assert.equal(payload.headers["authentication-results"], undefined);

	// Objects written before this change carry only the envelope and recover without signals.
	await bucket.put("inbound/old.eml", raw, { customMetadata: { from: "a@sender.example", to: "b@mail.example" } });
	const old = await lib.recoverPayload({ BUCKET: bucket }, "inbound/old.eml");
	assert.equal("verdicts" in old, false);
	assert.equal("senderIp" in old, false);
});

test("provider intake rejects over-limit attachments with the scan, never a parse", async () => {
	globalThis.__parseCalls = 0;
	const pdf = (n) => `--b\r\nContent-Type: application/pdf; name="f${n}.pdf"\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: attachment; filename="f${n}.pdf"\r\n\r\nQUFB\r\n`;
	const message = (count) => encoder.encode(`From: a@sender.example\r\nTo: b@mail.example\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="b"\r\n\r\n--b\r\nContent-Type: text/plain\r\n\r\nhi\r\n${Array.from({ length: count }, (_, i) => pdf(i)).join("")}--b--\r\n`).buffer;

	const dropped = await lib.intakeProviderMail({}, { from: "a@sender.example", recipients: ["b@mail.example"], raw: message(11) });
	assert.equal(dropped.delivered, 0);
	assert.match(dropped.dropped, /more than 10 attachments/);

	// Under the limit the message goes on to recipient lookup; no known domain means nothing is delivered.
	globalThis.__testDb = { select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }) };
	assert.deepEqual(await lib.intakeProviderMail({}, { from: "a@sender.example", recipients: ["b@mail.example"], raw: message(3) }), { delivered: 0, dropped: null });
	assert.equal(globalThis.__parseCalls, 0);
	delete globalThis.__testDb;
});
