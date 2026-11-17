import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SANITIZER = /^(src\/lib\/email\/html\.ts|dompurify|css-tree|parse5)$/;

/** Module graph of an entry, as esbuild sees it, without writing anything. */
async function moduleGraph(entry) {
	const result = await build({
		entryPoints: [join(root, entry)],
		bundle: true,
		write: false,
		metafile: true,
		platform: "browser",
		format: "esm",
		jsx: "automatic",
		tsconfig: join(root, "tsconfig.json"),
		packages: "external",
		loader: { ".css": "empty", ".scss": "empty", ".svg": "empty", ".png": "empty" },
		logLevel: "silent",
	});
	return result.metafile.inputs;
}

/** Every module reachable from `entry` through static imports only, with the chain that reached it. */
function staticClosure(inputs, entry) {
	const parent = new Map([[entry, null]]);
	const queue = [entry];
	while (queue.length) {
		const key = queue.shift();
		for (const edge of inputs[key]?.imports ?? []) {
			if (edge.kind !== "import-statement" || parent.has(edge.path)) continue;
			parent.set(edge.path, key);
			if (!edge.external) queue.push(edge.path);
		}
	}
	return parent;
}

function chainTo(parent, key) {
	const chain = [];
	for (let current = key; current; current = parent.get(current)) chain.unshift(current);
	return chain.join(" -> ");
}

test("message list pages do not statically import the email HTML sanitizer", async () => {
	const entry = "src/components/messages/message-folder-page.tsx";
	const closure = staticClosure(await moduleGraph(entry), entry);
	const leaks = [...closure.keys()].filter((key) => SANITIZER.test(key) || key.endsWith("compose/rich-text-utils.ts"));
	assert.deepEqual(leaks.map((key) => chainTo(closure, key)), []);
});

test("reply and forward drafts still reach the sanitizer, through a dynamic import", async () => {
	const entry = "src/components/message-actions/utils.ts";
	const inputs = await moduleGraph(entry);
	const closure = staticClosure(inputs, entry);
	assert.equal([...closure.keys()].some((key) => SANITIZER.test(key)), false);
	const dynamic = inputs[entry].imports.filter((edge) => edge.kind === "dynamic-import").map((edge) => edge.path);
	assert.deepEqual(dynamic, ["src/app/(dashboard)/inbox/[messageId]/email-html-sanitizer.ts"]);
});

test("rich-text-utils keeps exporting the sanitizer-free helpers", async () => {
	const inputs = await moduleGraph("src/components/compose/rich-text-utils.ts");
	const output = await build({
		entryPoints: [join(root, "src/components/compose/rich-text-utils.ts")],
		bundle: true,
		write: false,
		metafile: true,
		platform: "browser",
		format: "esm",
		tsconfig: join(root, "tsconfig.json"),
		packages: "external",
		logLevel: "silent",
	});
	const exports = Object.values(output.metafile.outputs)[0].exports.sort();
	assert.ok(inputs["src/components/compose/rich-text-core-utils.ts"]);
	assert.deepEqual(exports, [
		"QUOTE_ATTRIBUTE",
		"applyMailboxSignatureHtml",
		"escapeHtml",
		"hasMeaningfulHtml",
		"htmlToPlainText",
		"isHtmlSignature",
		"joinQuotedHtml",
		"signatureToHtml",
		"splitQuotedHtml",
		"textToHtml",
		"wrapQuotedHtml",
	]);
});
