// Renders the real root layout the way vinext does (React Server Components, then SSR of the
// Flight stream with React DOM) and counts the locale catalog preloads in the HTML head.
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(root, "node_modules", "layout-preload-test-"));
after(() => rmSync(outDir, { recursive: true, force: true }));

// The Flight renderer vinext actually runs (through @vitejs/plugin-rsc).
const flightDir = join(root, "node_modules/@vitejs/plugin-rsc/dist/vendor/react-server-dom");

const stubs = new Map([
	["next/font/google", "export const Geist = () => ({ variable: 'geist' }); export const Geist_Mono = () => ({ variable: 'geist-mono' });"],
	["@/components/providers", "export function Providers({ children }) { return children; }"],
	["@/components/language-provider", "export function LanguageProvider({ children }) { return children; }"],
	["@/lib/i18n/server", "export async function getRequestLocale() { return globalThis.layoutTestLocale; } export async function loadServerMessages() { return { ok: 'ok' }; }"],
	["./home-server-utils", "export async function getHomeBranding() { return { appName: 'Mailclaw', iconHref: null }; }"],
	["./globals.css", ""],
]);

const serverEntry = join(outDir, "server-entry.tsx");
writeFileSync(serverEntry, [
	`import { renderToReadableStream } from ${JSON.stringify(join(flightDir, "server.edge.js"))};`,
	`import RootLayout from ${JSON.stringify(join(root, "src/app/layout.tsx"))};`,
	// The shape the layout used before: a preload `<link>` element rendered by a Server Component.
	"function LinkElementLayout() { return <html><head><link rel=\"preload\" href=\"/locales/pt-BR.json\" as=\"fetch\" crossOrigin=\"anonymous\" /></head><body>x</body></html>; }",
	"export const renderLayout = () => renderToReadableStream(<RootLayout><main>page</main></RootLayout>, {});",
	"export const renderLinkElement = () => renderToReadableStream(<LinkElementLayout />, {});",
].join("\n"));

await build({
	entryPoints: [serverEntry],
	outfile: join(outDir, "server.mjs"),
	bundle: true,
	platform: "node",
	format: "esm",
	jsx: "automatic",
	conditions: ["react-server"],
	alias: { "@": join(root, "src") },
	define: { "process.env.NODE_ENV": "\"production\"" },
	logLevel: "silent",
	plugins: [{
		name: "layout-stubs",
		setup(esbuild) {
			esbuild.onResolve({ filter: /^(?:next\/font\/google|@\/components\/(?:providers|language-provider)|@\/lib\/i18n\/server|\.\/home-server-utils|\.\/globals\.css)$/ }, (args) => ({ path: args.path, namespace: "layout-stub" }));
			esbuild.onLoad({ filter: /.*/, namespace: "layout-stub" }, (args) => ({ contents: stubs.get(args.path), loader: "js" }));
		},
	}],
});

const ssrEntry = join(outDir, "ssr-entry.tsx");
writeFileSync(ssrEntry, [
	"import { use } from \"react\";",
	`import { createFromReadableStream } from ${JSON.stringify(join(flightDir, "client.edge.js"))};`,
	"import { renderToReadableStream } from \"react-dom/server.edge\";",
	"export async function renderHtml(flight) {",
	"\tlet tree;",
	// Read the Flight stream from inside the SSR render, as vinext does, so its hints reach this render.
	"\tfunction Root() { tree ??= createFromReadableStream(flight, { serverConsumerManifest: { moduleMap: {}, serverModuleMap: null, moduleLoading: null } }); return use(tree); }",
	"\tconst stream = await renderToReadableStream(<Root />);",
	"\tawait stream.allReady;",
	"\treturn new Response(stream).text();",
	"}",
].join("\n"));

await build({
	entryPoints: [ssrEntry],
	outfile: join(outDir, "ssr.mjs"),
	bundle: true,
	platform: "node",
	format: "esm",
	jsx: "automatic",
	define: { "process.env.NODE_ENV": "\"production\"" },
	logLevel: "silent",
});

// React's edge builds look for the global the Workers runtime provides.
globalThis.AsyncLocalStorage ??= AsyncLocalStorage;
const { renderLayout, renderLinkElement } = await import(pathToFileURL(join(outDir, "server.mjs")).href);
const { renderHtml } = await import(pathToFileURL(join(outDir, "ssr.mjs")).href);

const catalogPreloads = (html) => html.match(/<link[^>]*href="\/locales\/[^"]+\.json"[^>]*>/g) ?? [];

test("a preload <link> element in a Server Component reaches the HTML twice (the old layout's bug)", async () => {
	const html = await renderHtml(renderLinkElement());
	assert.equal(catalogPreloads(html).length, 2, html);
});

test("the root layout preloads a translated catalog exactly once, in the head", async (t) => {
	globalThis.layoutTestLocale = "pt-BR";
	t.after(() => { delete globalThis.layoutTestLocale; });
	const html = await renderHtml(renderLayout());
	const links = catalogPreloads(html);
	assert.equal(links.length, 1, html);
	assert.match(links[0], /rel="preload"/);
	assert.match(links[0], /as="fetch"/);
	assert.match(links[0], /crossorigin=""/);
	assert.ok(html.indexOf(links[0]) < html.indexOf("</head>"));
	assert.match(html, /<main>page<\/main>/);
});

test("the root layout preloads nothing for English", async (t) => {
	globalThis.layoutTestLocale = "en";
	t.after(() => { delete globalThis.layoutTestLocale; });
	const html = await renderHtml(renderLayout());
	assert.equal(catalogPreloads(html).length, 0, html);
	assert.match(html, /<main>page<\/main>/);
});
