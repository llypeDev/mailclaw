import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test, { after } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

// Draft autosave failures (plan item 2.7): a failed save is reported once per run of failures,
// the header says the draft is not saved, the next edit retries and a success clears it.

const root = fileURLToPath(new URL("../", import.meta.url));
const temp = mkdtempSync(join(root, "node_modules", "mailclaw-draft-autosave-"));
after(() => rmSync(temp, { recursive: true, force: true }));

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://mail.example/" });
for (const key of ["window", "document", "HTMLElement", "Element", "Node", "Event", "HTMLInputElement", "File", "FormData"]) {
	globalThis[key] = key === "window" ? dom.window : dom.window[key];
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mock = new Map([
	["next/navigation", `export function useRouter() { return { push() {}, replace() {} }; }`],
	["@/components/language-provider", `export function useLanguage() { return { t(key) { return key; } }; }`],
	["@/components/mailbox-provider", `export function useSelectedMailbox() { return globalThis.__autosaveMailboxes; }`],
	["@/components/compose/compose-context", `export function useCompose() { return { showNotice() {}, openDraftComposer() {}, isCurrentNotice() { return false; } }; }`],
	["@/lib/auth/client", `export function authFetch(...args) { return globalThis.__autosaveFetch(...args); }`],
	["@/lib/messages/detail-cache", `export function clearMessageDetailCache() {}`],
	["@/components/compose/utils", `
export async function fetchDraft() { throw new Error("No draft is loaded in this test"); }
export function formatAttachmentSize(bytes) { return String(bytes); }
export function buildSendFormData() { throw new Error("No send in this test"); }
`],
	["@/components/sidebar-mobile-utils", `export function useIsMobile() { return false; }`],
	["@/components/compose/use-sheet-viewport", `export function useSheetViewport() {}`],
	["@/components/compose/rich-text-editor", `
import React from "react";
export function RichTextEditor({ value, onChange, toolbarStart, toolbarEnd, footerContent, disabled }) {
	return React.createElement("div", {}, toolbarStart,
		React.createElement("textarea", { "data-body": "yes", value: value || "", onChange: (event) => onChange(event.target.value), disabled }),
		toolbarEnd, footerContent);
}
`],
	["@/components/compose/recipient-input", `export function RecipientInput() { return null; }`],
	["@/components/compose/schedule-send-menu", `export function ScheduleSendMenu() { return null; }`],
	["@/components/agent/send-review", `export function SendReview() { return null; }`],
]);
const relativeMocks = {
	"./utils": "@/components/compose/utils",
	"./rich-text-editor": "@/components/compose/rich-text-editor",
	"./recipient-input": "@/components/compose/recipient-input",
	"./schedule-send-menu": "@/components/compose/schedule-send-menu",
	"./use-sheet-viewport": "@/components/compose/use-sheet-viewport",
};

const genericUI = `
import React from "react";
export function Button({ children, size, variant, asChild, ...props }) { return React.createElement("button", props, children); }
export const Input = React.forwardRef(function Input({ size, variant, containerClassName, ...props }, ref) { return React.createElement("input", { ...props, ref }); });
export function Label({ children, ...props }) { return React.createElement("label", props, children); }
export function Select({ children, containerClassName, ...props }) { return React.createElement("select", props, children); }
export function Tooltip({ children }) { return children; }
`;

const composeDir = join(root, "src/components/compose");
await build({
	stdin: {
		contents: readFileSync(process.env.MAILCLAW_TEST_COMPOSE_SOURCE || join(composeDir, "compose-form.tsx"), "utf8"),
		sourcefile: "compose-form.tsx",
		resolveDir: composeDir,
		loader: "tsx",
	},
	outfile: join(temp, "compose.mjs"),
	bundle: true,
	platform: "browser",
	format: "esm",
	jsx: "automatic",
	packages: "external",
	external: ["react", "react-dom", "react-dom/*", "lucide-react"],
	alias: { "@": join(root, "src") },
	plugins: [{
		name: "autosave-stubs",
		setup(b) {
			b.onResolve({ filter: /.*/ }, (args) => {
				const inCompose = args.importer === "compose-form.tsx" || args.importer.startsWith(composeDir) || args.resolveDir === composeDir;
				if (inCompose && relativeMocks[args.path]) return { path: relativeMocks[args.path], namespace: "autosave-stub" };
				if (mock.has(args.path)) return { path: args.path, namespace: "autosave-stub" };
				if (/^@\/components\/ui\//.test(args.path)) return { path: args.path, namespace: "autosave-ui" };
				return undefined;
			});
			b.onLoad({ filter: /.*/, namespace: "autosave-stub" }, (args) => ({ contents: mock.get(args.path), loader: "tsx" }));
			b.onLoad({ filter: /.*/, namespace: "autosave-ui" }, () => ({ contents: genericUI, loader: "tsx" }));
		},
	}],
	logLevel: "silent",
});
const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { ComposeForm } = await import(pathToFileURL(join(temp, "compose.mjs")).href);

const mailbox = { id: "mailbox-1", localPart: "tester", hostname: "example.com", displayName: "Tester", senderAddresses: ["tester@example.com"], signature: "" };
globalThis.__autosaveMailboxes = { selectedMailbox: mailbox, setSelectedMailbox() {}, mailboxes: [mailbox] };

function response(data, status = 200) {
	return { ok: status >= 200 && status < 300, status, async json() { return data; } };
}
async function delay(milliseconds) {
	await act(async () => { await new Promise((resolve) => setTimeout(resolve, milliseconds)); });
}

test("a failed autosave is reported once, retried on the next edit and cleared by a success", async (t) => {
	const saves = [];
	let mode = "fail";
	globalThis.__autosaveFetch = async (url, options = {}) => {
		const method = options.method || "GET";
		if (url === "/api/attachment-policy") return response({ maxMb: 25, cloudThresholdBytes: 3000000 });
		if (url === "/api/drafts" && method === "POST") {
			saves.push(mode);
			if (mode === "fail") return response({ error: "Database unavailable" }, 503);
			if (mode === "throw") throw new TypeError("Failed to fetch");
			return response({ draft: { id: "draft-1" } });
		}
		throw new Error("Unexpected route: " + method + " " + url);
	};
	const container = document.createElement("div");
	document.body.appendChild(container);
	const reactRoot = createRoot(container);
	t.after(async () => { await act(async () => reactRoot.unmount()); container.remove(); });
	await act(async () => { reactRoot.render(createElement(ComposeForm, {})); });

	const alertText = () => [...container.querySelectorAll('[role="alert"]')].map((node) => node.textContent).join("|");
	const headerText = () => container.querySelector("form").textContent;
	async function typeSubject(value) {
		const input = container.querySelector('input[id="page-subject"]');
		await act(async () => {
			Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, value);
			input.dispatchEvent(new window.Event("input", { bubbles: true }));
		});
	}

	await typeSubject("Hello");
	await delay(1100);
	assert.deepEqual(saves, ["fail"]);
	assert.match(alertText(), /compose\.error\.autosave/, "the first failure shows a toast");
	assert.match(headerText(), /compose\.notSaved/, "the header says the draft is not saved");
	assert.doesNotMatch(headerText(), /compose\.title\.saved/);

	// Let the toast expire, then fail again (this time with a network error): no second toast.
	await delay(3300);
	assert.equal(alertText(), "");
	mode = "throw";
	await typeSubject("Hello again");
	await delay(1100);
	assert.deepEqual(saves, ["fail", "throw"], "the next edit retries the save");
	assert.equal(alertText(), "", "a continuing failure does not toast again");
	assert.match(headerText(), /compose\.notSaved/);

	mode = "ok";
	await typeSubject("Hello, finally");
	await delay(1100);
	assert.deepEqual(saves, ["fail", "throw", "ok"]);
	assert.doesNotMatch(headerText(), /compose\.notSaved/, "a successful save clears the warning");
	assert.match(headerText(), /compose\.title\.saved/);
});

test("debounced edits produce one save, not one per keystroke", async (t) => {
	let posts = 0;
	globalThis.__autosaveFetch = async (url, options = {}) => {
		if (url === "/api/attachment-policy") return response({ maxMb: 25, cloudThresholdBytes: 3000000 });
		if (url === "/api/drafts" && options.method === "POST") { posts += 1; return response({ error: "nope" }, 500); }
		throw new Error("Unexpected route: " + url);
	};
	const container = document.createElement("div");
	document.body.appendChild(container);
	const reactRoot = createRoot(container);
	t.after(async () => { await act(async () => reactRoot.unmount()); container.remove(); });
	await act(async () => { reactRoot.render(createElement(ComposeForm, {})); });
	const input = container.querySelector('input[id="page-subject"]');
	for (const value of ["H", "He", "Hel", "Hell", "Hello"]) {
		await act(async () => {
			Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, value);
			input.dispatchEvent(new window.Event("input", { bubbles: true }));
		});
		await delay(100);
	}
	await delay(1100);
	assert.equal(posts, 1);
	assert.equal(container.querySelectorAll('[role="alert"]').length, 1);
});
