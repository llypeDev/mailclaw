import assert from "node:assert/strict";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { loadFixture } from "./helpers/fixtures.mjs";

const fixture = await loadFixture({ name: "email-html-frame", entryPoint: "src/components/messages/email-html-renderer-utils.ts", mocks: {} });
after(() => fixture.dispose());
const frame = await fixture.import();

const dom = new JSDOM("", { url: "https://mail.example/inbox/m1" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
const readerBundle = await build({
	stdin: {
		contents: `export { prepareReaderEmailHtml } from "./src/lib/remote-images/reader";
			export { collapseQuotedEmailHtml } from "./src/app/(dashboard)/inbox/[messageId]/quote-collapse-utils";`,
		resolveDir: process.cwd(),
		loader: "ts",
	},
	alias: { "@": `${process.cwd()}/src` },
	bundle: true, write: false, platform: "browser", format: "esm", logLevel: "silent",
});
const reader = await import(`data:text/javascript;base64,${Buffer.from(readerBundle.outputFiles[0].text).toString("base64")}`);

function directives(csp) {
	return new Map(csp.split(";").map(part => part.trim().split(/\s+/)).map(([name, ...values]) => [name, values]));
}

test("the frame policy allows only inline styles and the app's image routes", () => {
	const policy = directives(frame.buildEmailFrameCsp({ origin: "https://mail.example/", directRemote: false }));
	assert.deepEqual(policy.get("default-src"), ["'none'"]);
	assert.deepEqual(policy.get("script-src"), ["'none'"]);
	assert.deepEqual(policy.get("style-src"), ["'unsafe-inline'"]);
	assert.deepEqual(policy.get("img-src"), ["data:", "https://mail.example/api/remote-images", "https://mail.example/api/messages/"]);
	assert.deepEqual(policy.get("base-uri"), ["'none'"]);
	assert.deepEqual(policy.get("form-action"), ["'none'"]);
	assert.equal(policy.has("connect-src"), false, "default-src 'none' covers fetches");
});

test("remote images load from the network only when the proxy is off", () => {
	const proxied = directives(frame.buildEmailFrameCsp({ origin: "https://mail.example", directRemote: false }));
	assert.equal(proxied.get("img-src").includes("https:"), false);
	const direct = directives(frame.buildEmailFrameCsp({ origin: "https://mail.example", directRemote: true }));
	assert.equal(direct.get("img-src").includes("https:"), true);
});

test("the frame document puts its policy before any mail markup", () => {
	const csp = frame.buildEmailFrameCsp({ origin: "https://mail.example", directRemote: false });
	const source = frame.buildEmailFrameDocument({
		html: "<p>Hello</p>",
		csp,
		style: "p{color:red}/*</style><script>alert(1)</script>*/",
		dir: "rtl\"><script>",
		classes: ["mf-dark", false, null, "mf-dense"],
	});
	const doc = new JSDOM(source).window.document;
	const head = doc.head.children;
	assert.equal(head[0].getAttribute("charset"), "utf-8");
	assert.equal(head[1].getAttribute("http-equiv"), "Content-Security-Policy");
	assert.equal(head[1].getAttribute("content"), csp);
	assert.equal(doc.querySelector("meta[name=referrer]").getAttribute("content"), "no-referrer");
	assert.equal(doc.querySelector("base").getAttribute("target"), "_blank");
	assert.equal(doc.querySelector("base").hasAttribute("href"), false);
	assert.equal(doc.querySelectorAll("script").length, 0, "neither the style nor the dir can close their context");
	assert.equal(doc.documentElement.getAttribute("dir"), "rtl\"><script>");
	assert.equal(doc.documentElement.className, "mf-dark mf-dense");
	assert.equal(doc.body.innerHTML, "<p>Hello</p>");
});

test("the base style scopes mail roots and theme classes", () => {
	const style = frame.frameBaseStyle("mail-root-a", "mail-body-a");
	assert.match(style, /mail-root-a \{ display:block;/);
	assert.match(style, /html\.mf-dark \{ filter:invert\(1\) hue-rotate\(180deg\); \}/);
	assert.match(style, /html\.mf-dark img/);
	assert.match(style, /html\.mf-dense p \{ margin-top:0; \}/);
	assert.match(style, /body \{ margin:0; overflow-x:auto; overflow-y:hidden; \}/);
});

test("links are classified for the parent click handler", () => {
	assert.deepEqual(frame.classifyEmailFrameLink(null), { kind: "none" });
	assert.deepEqual(frame.classifyEmailFrameLink(""), { kind: "none" });
	assert.deepEqual(frame.classifyEmailFrameLink("#section%201"), { kind: "fragment", id: "section 1" });
	assert.deepEqual(frame.classifyEmailFrameLink("#%E0%A4%A"), { kind: "fragment", id: "%E0%A4%A" });
	assert.deepEqual(frame.classifyEmailFrameLink("mailto:a@example.com?subject=Hi"), { kind: "handler", href: "mailto:a@example.com?subject=Hi" });
	assert.deepEqual(frame.classifyEmailFrameLink("TEL:+15551234"), { kind: "handler", href: "TEL:+15551234" });
	assert.deepEqual(frame.classifyEmailFrameLink("https://example.com/"), { kind: "external" });
	assert.deepEqual(frame.classifyEmailFrameLink("javascript:alert(1)"), { kind: "none" });
});

test("the frame height covers the content and a horizontal scrollbar", () => {
	assert.equal(frame.emailFrameHeight({ scrollHeight: 300, offsetHeight: 300, clientHeight: 300 }), 300);
	assert.equal(frame.emailFrameHeight({ scrollHeight: 300.4, offsetHeight: 315, clientHeight: 300 }), 316);
	assert.equal(frame.emailFrameHeight({ scrollHeight: 0, offsetHeight: 0, clientHeight: 0 }), 0);
});

test("keys typed in the frame are forwarded, except Tab and IME composition", () => {
	assert.equal(frame.shouldForwardFrameKey({ key: "e", isComposing: false }), true);
	assert.equal(frame.shouldForwardFrameKey({ key: "Escape", isComposing: false }), true);
	assert.equal(frame.shouldForwardFrameKey({ key: "Tab", isComposing: false }), false);
	assert.equal(frame.shouldForwardFrameKey({ key: "e", isComposing: true }), false);
	const init = frame.forwardedKeyboardEventInit({ key: "k", code: "KeyK", location: 0, repeat: false, ctrlKey: true, shiftKey: false, altKey: false, metaKey: false });
	assert.deepEqual(init, { key: "k", code: "KeyK", location: 0, repeat: false, ctrlKey: true, shiftKey: false, altKey: false, metaKey: false, bubbles: true, cancelable: true, composed: true });
});

test("a hostile message reaches the frame without script, handlers or forms", () => {
	const source = `<html><head><meta http-equiv="refresh" content="0;url=https://evil.example"><base href="https://evil.example/"><script>parent.alert(1)</script></head>
<body onload="alert(2)"><img src="x" onerror="alert(3)"><svg><script>alert(4)</script></svg>
<a href="javascript:alert(5)">bad</a><a href="#top">top</a><a href="https://example.com/">ok</a>
<iframe src="https://evil.example"></iframe><form action="https://evil.example"><input name="p"></form>
<p>On Mon, Jan 1, 2026 at 9:00 AM Ann wrote:</p><blockquote>quoted</blockquote></body></html>`;
	const prepared = reader.prepareReaderEmailHtml(source, { reader: true, allowRemote: false });
	const html = reader.collapseQuotedEmailHtml(prepared.html, false, "Toggle quoted email");
	const doc = new JSDOM(frame.buildEmailFrameDocument({
		html,
		csp: frame.buildEmailFrameCsp({ origin: "https://mail.example", directRemote: false }),
		style: frame.frameBaseStyle(prepared.rootTag, prepared.bodyTag),
		dir: "ltr",
		classes: [],
	})).window.document;
	assert.equal(doc.querySelectorAll("script, iframe, form, input").length, 0);
	assert.equal(doc.querySelectorAll("meta[http-equiv=refresh]").length, 0);
	assert.equal(doc.querySelectorAll("base[href]").length, 0, "only the frame's own target-only base remains");
	for (const element of doc.querySelectorAll("*")) {
		for (const attribute of element.attributes) assert.doesNotMatch(attribute.name, /^on/i, `${element.tagName} ${attribute.name}`);
	}
	assert.equal(doc.querySelector("a[href^='javascript']"), null);
	assert.equal(doc.querySelector("a[href='https://example.com/']").getAttribute("target"), "_blank");
	assert.equal(doc.querySelector("a[href='#top']").hasAttribute("target"), false);
	assert.ok(doc.querySelector("details.email-quote-toggle blockquote"), "the quote is folded");
	assert.equal(doc.head.children[1].getAttribute("http-equiv"), "Content-Security-Policy");
});
