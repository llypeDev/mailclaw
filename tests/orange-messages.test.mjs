import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { enUS, esES, ptBR } from "@orangesys/ui";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bundleDirectory = mkdtempSync(join(root, "node_modules", "mailclaw-orange-messages-"));
await build({
	entryPoints: [join(root, "src", "components", "orange-provider-utils.ts")],
	outfile: join(bundleDirectory, "entry.mjs"),
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node24",
	tsconfig: join(root, "tsconfig.json"),
	logLevel: "silent",
});
const { ORANGE_KEY_PREFIX, missingOrangeKeys, orangeCatalogKey, orangeMessages } = await import(pathToFileURL(join(bundleDirectory, "entry.mjs")).href);
rmSync(bundleDirectory, { recursive: true, force: true });

const catalog = (code) => JSON.parse(readFileSync(join(root, "public", "locales", `${code}.json`), "utf8"));
const en = catalog("en");
const placeholders = (text) => [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]))].sort();

test("every Orange message key has an orange.* key in the English catalog", () => {
	// A new @orangesys/ui release that adds component texts fails here until en.json (and, through the
	// i18n parity test, every catalog) carries them.
	assert.deepEqual(missingOrangeKeys(enUS, en), [], "add the missing keys to every catalog under orange.*");
	for (const dictionary of [ptBR, esES]) assert.deepEqual(Object.keys(dictionary).sort(), Object.keys(enUS).sort());
});

test("the catalog has no orange.* key Orange does not know, and keeps Orange's placeholders", () => {
	const known = new Set(Object.keys(enUS).map(orangeCatalogKey));
	const stale = Object.keys(en).filter((key) => key.startsWith(ORANGE_KEY_PREFIX) && !known.has(key));
	assert.deepEqual(stale, []);
	for (const [key, text] of Object.entries(enUS)) assert.deepEqual(placeholders(en[orangeCatalogKey(key)]), placeholders(text), key);
});

test("orangeMessages reads the catalog raw and falls back to the reference text", () => {
	const translations = { "orange.close": "Fermer", "orange.pageOf": "Page {page} sur {total}" };
	const messages = orangeMessages(enUS, (key) => translations[key] ?? key);
	assert.equal(messages.close, "Fermer");
	assert.equal(messages.pageOf, "Page {page} sur {total}");
	assert.equal(messages.nextPage, enUS.nextPage);
	assert.deepEqual(Object.keys(messages).sort(), Object.keys(enUS).sort());
});
