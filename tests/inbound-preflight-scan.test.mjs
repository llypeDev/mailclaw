import assert from "node:assert/strict";
import { after, test } from "node:test";
import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const dir = mkdtempSync(join(tmpdir(), "inbound-preflight-scan-"));
after(() => rmSync(dir, { recursive: true, force: true }));
const outfile = join(dir, "entry.mjs");
await build({
	stdin: {
		contents: `
			export { parseRawMime } from "./src/lib/email/parse.ts";
			export { scanMimeAttachments, mimePreflightReason } from "./src/lib/email/mime-preflight.ts";
			export { inboundAttachmentLimitReasonFromScan, inboundAttachmentLimitReasonFromRaw } from "./src/lib/email/inbound-attachments.ts";
		`,
		resolveDir: root,
		sourcefile: "inbound-preflight-scan-entry.ts",
	},
	outfile,
	bundle: true,
	platform: "node",
	format: "esm",
	alias: { "@": join(root, "src") },
	logLevel: "silent",
	banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
});
const { parseRawMime, scanMimeAttachments, mimePreflightReason, inboundAttachmentLimitReasonFromScan, inboundAttachmentLimitReasonFromRaw } = await import(pathToFileURL(outfile).href);

const enc = new TextEncoder();
const hdr = "From: a@b.example\r\nTo: c@d.example\r\nSubject: x\r\nMIME-Version: 1.0\r\n";
const b64 = "QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFB\r\n";
const pdf = (name) => `Content-Type: application/pdf; name="${name}"\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: attachment; filename="${name}"\r\n\r\n${b64}`;
const text = (body) => `Content-Type: text/plain; charset=utf-8\r\n\r\n${body}\r\n`;
const html = (body) => `Content-Type: text/html; charset=utf-8\r\n\r\n${body}\r\n`;
const inlineImage = (n) => `Content-Type: image/png\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: inline\r\nContent-ID: <img${n}@x>\r\n\r\n${b64}`;
const multipart = (type, boundary, parts, extra = "") => `Content-Type: multipart/${type}; boundary="${boundary}"${extra}\r\n\r\npreamble\r\n${parts.map((part) => `--${boundary}\r\n${part}`).join("")}--${boundary}--\r\nepilogue\r\n`;

const cases = {
	plain: `${hdr}Content-Type: text/plain\r\n\r\nhello\r\n`,
	noContentType: `${hdr}\r\nhello\r\n`,
	rootPdf: `${hdr}${pdf("a.pdf")}`,
	tenAttachments: hdr + multipart("mixed", "b1", [text("hi"), ...Array.from({ length: 10 }, (_, i) => pdf(`f${i}.pdf`))]),
	elevenAttachments: hdr + multipart("mixed", "b1", [text("hi"), ...Array.from({ length: 11 }, (_, i) => pdf(`f${i}.pdf`))]),
	alternativeWithInlineImages: hdr + multipart("related", "rel", [
		multipart("alternative", "alt", [text("hi"), html("<p>hi</p>")]),
		...Array.from({ length: 12 }, (_, i) => inlineImage(i)),
	]),
	textAttachment: hdr + multipart("mixed", "m", [text("hi"), "Content-Type: text/plain\r\nContent-Disposition: attachment; filename=notes.txt\r\n\r\nnotes\r\n"]),
	calendar: hdr + multipart("alternative", "c", [text("hi"), "Content-Type: text/calendar; method=REQUEST\r\n\r\nBEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n"]),
	// Lines that look like parts inside a text body must not count: only declared boundaries split.
	fakeBoundaries: hdr + multipart("mixed", "real", [text(Array.from({ length: 15 }, () => "--fake\r\nContent-Type: application/pdf\r\nContent-Disposition: attachment\r\n\r\nx").join("\r\n"))]),
	// With forceRfc822Attachments an attached message is one attachment, whatever it contains.
	attachedMessage: hdr + multipart("mixed", "outer", [
		text("see attached"),
		`Content-Type: message/rfc822\r\nContent-Disposition: attachment\r\n\r\nFrom: x@y.example\r\n${multipart("mixed", "inner", Array.from({ length: 12 }, (_, i) => pdf(`in${i}.pdf`)))}`,
	]),
	digest: hdr + multipart("digest", "d", Array.from({ length: 3 }, (_, i) => `\r\nFrom: p${i}@q.example\r\nSubject: s\r\n\r\nbody\r\n`)),
	foldedAndCommented: `${hdr}Content-Type: multipart/mixed (a comment);\r\n\tboundary="folded b"\r\n\r\n--folded b\r\n${text("hi")}--folded b\r\nContent-Type: application/zip;\r\n name=a.zip\r\n\r\nzz\r\n--folded b--\r\n`,
	lastContentTypeWins: hdr + multipart("mixed", "m", [`Content-Type: application/pdf\r\nContent-Type: text/plain\r\n\r\nbody\r\n`]),
	firstDispositionWins: hdr + multipart("mixed", "m", [`Content-Type: text/plain\r\nContent-Disposition: attachment\r\nContent-Disposition: inline\r\n\r\nbody\r\n`]),
	spaceBeforeColon: hdr + multipart("mixed", "m", [`Content-Type : image/gif\r\n\r\nGIF\r\n`]),
	deepNesting: hdr + multipart("mixed", "l1", [multipart("mixed", "l2", [multipart("alternative", "l3", [text("a"), html("b")]), pdf("x.pdf")]), pdf("y.pdf")]),
	prefixBoundary: hdr + multipart("mixed", "ab", [text("--abc\r\n--ab-\r\nstill text"), pdf("z.pdf")]),
	unterminated: `${hdr}Content-Type: multipart/mixed; boundary=u\r\n\r\n--u\r\n${pdf("a.pdf")}--u\r\nContent-Type: image/png\r\n`,
	lfOnly: (hdr + multipart("mixed", "lf", [text("hi"), pdf("a.pdf"), pdf("b.pdf")])).replace(/\r\n/g, "\n"),
};

test("the scan counts the attachments postal-mime returns, for every shape", async () => {
	for (const [name, message] of Object.entries(cases)) {
		const raw = enc.encode(message).buffer;
		const parsed = await parseRawMime(raw);
		const scan = scanMimeAttachments(raw, 1000);
		assert.equal(scan.reason, null, name);
		assert.equal(scan.attachments, parsed.attachments.length, `${name}: scan ${scan.attachments}, postal-mime ${parsed.attachments.length}`);
	}
});

test("generated MIME trees count the same as postal-mime", async () => {
	let seed = 7;
	const random = (n) => {
		seed = (seed * 1103515245 + 12345) % 2147483648;
		return seed % n;
	};
	const leaves = [text("t"), html("<b>h</b>"), pdf("p.pdf"), inlineImage(1), "Content-Type: text/plain\r\nContent-Disposition: attachment\r\n\r\nx\r\n", "\r\nno headers\r\n", "Content-Type: message/rfc822\r\n\r\nFrom: a@b\r\n\r\nx\r\n"];
	let counter = 0;
	const tree = (depth) => {
		if (depth === 0 || random(3) === 0) return leaves[random(leaves.length)];
		const types = ["mixed", "alternative", "related", "digest"];
		const boundary = `g${counter++}`;
		return multipart(types[random(types.length)], boundary, Array.from({ length: 1 + random(4) }, () => tree(depth - 1)));
	};
	for (let round = 0; round < 200; round++) {
		const raw = enc.encode(hdr + tree(4)).buffer;
		const parsed = await parseRawMime(raw);
		assert.equal(scanMimeAttachments(raw, 1000).attachments, parsed.attachments.length, `round ${round}`);
	}
});

test("more than ten attachments is refused at receiving time, ten is not", async () => {
	assert.equal(inboundAttachmentLimitReasonFromScan(enc.encode(cases.tenAttachments).buffer), null);
	assert.match(inboundAttachmentLimitReasonFromScan(enc.encode(cases.elevenAttachments).buffer), /more than 10 attachments/);
	assert.match(inboundAttachmentLimitReasonFromScan(enc.encode(cases.alternativeWithInlineImages).buffer), /more than 10 attachments/);
	// Same verdicts as the full parse it replaces in the Worker handler.
	assert.equal(await inboundAttachmentLimitReasonFromRaw(enc.encode(cases.tenAttachments).buffer), null);
	assert.match(await inboundAttachmentLimitReasonFromRaw(enc.encode(cases.elevenAttachments).buffer), /more than 10 attachments/);
	assert.equal(inboundAttachmentLimitReasonFromScan(enc.encode(cases.attachedMessage).buffer), null);
	assert.equal(inboundAttachmentLimitReasonFromScan(enc.encode(cases.fakeBoundaries).buffer), null);
});

test("the scan keeps the preflight limits and the parse failures the old check bounced", async () => {
	const parts = `${hdr}Content-Type: multipart/mixed; boundary="b"\r\n\r\n${"--b\r\nContent-Type: text/plain\r\n\r\nx\r\n".repeat(2000)}`;
	assert.equal(inboundAttachmentLimitReasonFromScan(enc.encode(parts).buffer), mimePreflightReason(enc.encode(parts)));
	let nested = "Content-Type: text/plain\r\n\r\nleaf\r\n";
	for (let level = 0; level < 25; level++) nested = multipart("mixed", `n${level}`, [nested]);
	const deep = enc.encode(hdr + nested).buffer;
	await assert.rejects(parseRawMime(deep));
	assert.match(inboundAttachmentLimitReasonFromScan(deep), /nested too deeply/);
	const bigPartHeader = enc.encode(hdr + multipart("mixed", "h", [`X-Pad: ${"a".repeat(70 * 1024)}\r\n${text("x")}`])).buffer;
	await assert.rejects(parseRawMime(bigPartHeader));
	assert.match(inboundAttachmentLimitReasonFromScan(bigPartHeader), /header block exceeds 64 KiB/);
});

test("mimePreflightReason is unchanged by the counting mode", () => {
	const legit = enc.encode(hdr + multipart("mixed", "b", [text("hi"), pdf("a.pdf")]));
	assert.equal(mimePreflightReason(legit), null);
	assert.match(String(mimePreflightReason(enc.encode(`${hdr}\r\n${"a\r\n".repeat(50_000)}`))), /too many lines/);
});
