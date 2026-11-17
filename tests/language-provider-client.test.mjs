import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test, { after } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

// The browser side of the locale catalog: no catalog is in the page, English included, so LanguageProvider
// fetches /locales/<code>.json once (React `use`), renders translated, and reuses it for later renders.
const project = join(dirname(fileURLToPath(import.meta.url)), "..");
const directory = mkdtempSync(join(project, "node_modules", "language-provider-test-"));
after(() => rmSync(directory, { recursive: true, force: true }));
await build({
	stdin: {
		contents: `
			export { LanguageProvider, useLanguage } from "./src/components/language-provider";
			export { rememberCatalog, peekCatalog } from "./src/lib/i18n/catalog-store";
		`,
		resolveDir: project,
		loader: "ts",
	},
	outfile: join(directory, "provider.mjs"),
	bundle: true,
	platform: "node",
	format: "esm",
	packages: "external",
	alias: { "@": join(project, "src") },
	logLevel: "silent",
});

const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "https://mail.example.com/inbox" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const catalogRequests = [];
let offline = false;
globalThis.fetch = async (input) => {
	const path = String(input);
	catalogRequests.push(path);
	if (offline) throw new TypeError("Failed to fetch");
	const file = join(project, "public", path);
	return new Response(readFileSync(file), { headers: { "Content-Type": "application/json" } });
};
after(() => {
	dom.window.close();
	delete globalThis.window;
	delete globalThis.document;
	delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});

const { LanguageProvider, useLanguage, peekCatalog } = await import(pathToFileURL(join(directory, "provider.mjs")).href);
const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");

function Probe() {
	const { t, locale } = useLanguage();
	return createElement("span", { "data-locale": locale }, t("navigation.inbox"));
}

test("a non-English page loads its catalog from the static file once and renders translated", async () => {
	const container = document.getElementById("root");
	const root = createRoot(container);
	await act(async () => root.render(createElement(LanguageProvider, { initialLocale: "pt-BR" }, createElement(Probe))));
	assert.equal(container.textContent, "Entrada");
	assert.deepEqual(catalogRequests, ["/locales/pt-BR.json"]);
	assert.equal(peekCatalog("pt-BR")["navigation.inbox"], "Entrada");

	// A second provider (another tree, or a remount) reuses the parsed catalog without a request.
	const other = document.createElement("div");
	document.body.append(other);
	const secondRoot = createRoot(other);
	await act(async () => secondRoot.render(createElement(LanguageProvider, { initialLocale: "pt-BR" }, createElement(Probe))));
	assert.equal(other.textContent, "Entrada");
	assert.deepEqual(catalogRequests, ["/locales/pt-BR.json"]);
	await act(async () => {
		root.unmount();
		secondRoot.unmount();
	});
});

async function renderProvider(props) {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	await act(async () => root.render(createElement(LanguageProvider, props, createElement(Probe))));
	const text = container.textContent;
	await act(async () => root.unmount());
	return text;
}

test("English loads from its static file like any other catalog; an explicit catalog needs no request", async () => {
	catalogRequests.length = 0;
	assert.equal(await renderProvider({ initialLocale: "en" }), "Inbox");
	assert.deepEqual(catalogRequests, ["/locales/en.json"]);
	assert.equal(peekCatalog("en")["navigation.inbox"], "Inbox");
	// The root layout passes `catalogLocale` when the server could not read the chosen language's catalog.
	assert.equal(await renderProvider({ initialLocale: "fr", catalogLocale: "en" }), "Inbox", "rendered in English, as on the server");
	assert.equal(await renderProvider({ initialLocale: "fr", initialMessages: { "navigation.inbox": "Boîte" } }), "Boîte");
	assert.deepEqual(catalogRequests, ["/locales/en.json"], "English is fetched once per tab, and an explicit catalog not at all");
});

// English loaded in the previous test, so it is the fallback here without another request.
test("an unreachable catalog renders English once instead of failing, and choosing the language retries", async () => {
	catalogRequests.length = 0;
	offline = true;
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	let api;
	function Capture() {
		// eslint-disable-next-line react/globals -- test probe: hands the context value to the test body
		api = useLanguage();
		return createElement(Probe);
	}
	await act(async () => root.render(createElement(LanguageProvider, { initialLocale: "de" }, createElement(Capture))));
	assert.equal(container.textContent, "Inbox");
	await act(async () => root.render(createElement(LanguageProvider, { initialLocale: "de" }, createElement(Capture))));
	assert.deepEqual(catalogRequests, ["/locales/de.json"], "a re-render does not refetch");
	offline = false;
	await act(async () => api.setLocale("de"));
	assert.deepEqual(catalogRequests, ["/locales/de.json", "/locales/de.json"]);
	assert.equal(container.textContent, "Posteingang");
	await act(async () => root.unmount());
});
