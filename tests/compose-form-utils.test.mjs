import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bundleDirectory = mkdtempSync(join(root, "node_modules", "mailclaw-compose-form-utils-"));
await build({
	stdin: {
		contents: `export * from "./src/components/compose/compose-form-utils.ts";
			export { readErrorDigest } from "./src/app/error-screen-utils.ts";`,
		resolveDir: root,
		sourcefile: "compose-form-utils-test-entry.ts",
	},
	outfile: join(bundleDirectory, "entry.mjs"),
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node24",
	tsconfig: join(root, "tsconfig.json"),
	logLevel: "silent",
});
const utils = await import(pathToFileURL(join(bundleDirectory, "entry.mjs")).href);
rmSync(bundleDirectory, { recursive: true, force: true });
const { buildDraftPayload, composeTitleKey, findAttachmentBlocker, findSendBlocker, hasDraftContent, readErrorDigest } = utils;

const empty = { mailboxId: "mb", from: "a@example.com", to: [], cc: [], bcc: [], subject: "", html: "", quotedHtml: null, threading: null };

test("findSendBlocker reports the first problem in the order the composer checks them", () => {
	assert.deepEqual(findSendBlocker({ ...empty, scheduledAt: null }), { key: "compose.error.noRecipient" });
	assert.deepEqual(
		findSendBlocker({ ...empty, to: ["ok@example.com"], cc: ["not an address"], html: "<p>Hi</p>", scheduledAt: null }),
		{ key: "compose.error.invalidAddress", vars: { address: "not an address" } },
	);
	assert.deepEqual(findSendBlocker({ ...empty, to: ["ok@example.com"], html: "<p></p>", scheduledAt: null }), { key: "compose.error.emptyBody" });
	assert.equal(findSendBlocker({ ...empty, to: ["ok@example.com"], html: "", quotedHtml: "<blockquote>x</blockquote>", scheduledAt: null }), null);
	assert.deepEqual(
		findSendBlocker({ ...empty, to: ["ok@example.com"], html: "<p>Hi</p>", scheduledAt: new Date(Date.now() - 60_000) }),
		{ key: "schedule.pastTime" },
	);
	assert.equal(findSendBlocker({ ...empty, to: ["ok@example.com"], html: "<p>Hi</p>", scheduledAt: null }), null);
});

test("findAttachmentBlocker applies the count, per-file and total limits", () => {
	const policy = { maxMb: 2, cloudThresholdBytes: 1_000_000 };
	assert.deepEqual(findAttachmentBlocker({ storedSizes: [1, 1, 1], pendingSizes: [1, 1, 1, 1], nextSizes: [1, 1, 1, 1], policy }), { key: "compose.error.maxAttachments" });
	assert.deepEqual(findAttachmentBlocker({ storedSizes: [], pendingSizes: [], nextSizes: [2_000_001], policy }), { key: "compose.error.attachmentSize", vars: { max: 2 } });
	assert.deepEqual(findAttachmentBlocker({ storedSizes: [1_000_000], pendingSizes: [500_000], nextSizes: [600_000], policy }), { key: "compose.error.totalSize", vars: { max: 2 } });
	assert.equal(findAttachmentBlocker({ storedSizes: [1_000_000], pendingSizes: [], nextSizes: [1_000_000], policy }), null);
});

test("hasDraftContent ignores a body holding only the signature", () => {
	assert.equal(hasDraftContent(empty, 0, "Regards"), false);
	assert.equal(hasDraftContent({ ...empty, html: "<p>Regards</p>" }, 0, "Regards"), false);
	assert.equal(hasDraftContent({ ...empty, html: "<p>Hello</p><p>Regards</p>" }, 0, "Regards"), true);
	assert.equal(hasDraftContent({ ...empty, subject: " x " }, 0, null), true);
	assert.equal(hasDraftContent(empty, 1, null), true);
});

test("buildDraftPayload joins the quoted part and carries the threading headers", () => {
	const payload = buildDraftPayload({
		...empty,
		to: ["a@example.net", "b@example.net"],
		html: "<p>Reply</p>",
		threading: { inReplyTo: "<m@x>", references: "<m@x>", threadId: "t1" },
	});
	assert.equal(payload.to, "a@example.net, b@example.net");
	assert.equal(payload.inReplyTo, "<m@x>");
	assert.equal(payload.threadId, "t1");
	assert.match(payload.text, /Reply/);
	assert.deepEqual(Object.keys(payload), ["mailboxId", "from", "to", "cc", "bcc", "subject", "html", "text", "inReplyTo", "references", "threadId"]);
});

test("composeTitleKey prefers loading, then reply, then forward, then the saved state", () => {
	assert.equal(composeTitleKey({ loadingDraft: true, isReply: true, subject: "Fwd: x", saved: true }), "compose.title.loading");
	assert.equal(composeTitleKey({ loadingDraft: false, isReply: true, subject: "Fwd: x", saved: true }), "compose.title.reply");
	assert.equal(composeTitleKey({ loadingDraft: false, isReply: false, subject: "fw: x", saved: true }), "compose.title.forward");
	assert.equal(composeTitleKey({ loadingDraft: false, isReply: false, subject: "x", saved: true }), "compose.title.saved");
	assert.equal(composeTitleKey({ loadingDraft: false, isReply: false, subject: "x", saved: false }), "compose.title.new");
});

test("readErrorDigest only returns a non-empty string digest", () => {
	assert.equal(readErrorDigest(Object.assign(new Error("x"), { digest: "abc123" })), "abc123");
	assert.equal(readErrorDigest(new Error("x")), null);
	assert.equal(readErrorDigest({ digest: 42 }), null);
	assert.equal(readErrorDigest("boom"), null);
	assert.equal(readErrorDigest(null), null);
});
