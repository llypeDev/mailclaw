import type { EmailFrameCspOptions, EmailFrameDocumentOptions, EmailFrameLinkAction, EmailFrameMetrics } from "./email-html-renderer-types";

/**
 * Same origin so cookies reach cid: attachments and the remote image proxy,
 * popups so links open in a new tab outside the sandbox. No allow-scripts:
 * nothing in the frame can run even if sanitising missed something, and
 * without it allow-same-origin cannot be used to lift the sandbox.
 */
export const EMAIL_FRAME_SANDBOX = "allow-same-origin allow-popups allow-popups-to-escape-sandbox";

/** Image routes of the app the sanitizer rewrites mail resources to. */
export const EMAIL_FRAME_IMAGE_PATHS = ["/api/remote-images", "/api/messages/"];

/**
 * Policy for the frame document, on top of the app policy it inherits. Images
 * come from data: URIs, cid: attachments and the remote image proxy; straight
 * from the network only when the proxy is switched off and the reader allowed
 * remote content. Mail CSS stays inline; nothing else may load.
 */
export function buildEmailFrameCsp({ origin, directRemote }: EmailFrameCspOptions): string {
	const base = origin.replace(/\/+$/, "");
	const images = ["data:", ...EMAIL_FRAME_IMAGE_PATHS.map(path => base + path), ...(directRemote ? ["https:"] : [])];
	return [
		"default-src 'none'",
		`img-src ${images.join(" ")}`,
		"style-src 'unsafe-inline'",
		"script-src 'none'",
		"base-uri 'none'",
		"form-action 'none'",
	].join("; ");
}

export function frameBaseStyle(rootTag: string, bodyTag: string): string {
	// The frame viewport never scrolls; its height follows the content. Wide mail
	// scrolls sideways inside body, which keeps that scrollbar within the frame.
	return `html { overflow:hidden; color-scheme:light; }
body { margin:0; overflow-x:auto; overflow-y:hidden; }
html.mf-dark { filter:invert(1) hue-rotate(180deg); }
html.mf-dark img, html.mf-dark video, html.mf-dark picture { filter:invert(1) hue-rotate(180deg); }
.email-quote-toggle { margin-top:1.4em; }
.email-quote-toggle > summary { cursor:pointer; list-style:none; width:26px; background:#ececec; text-align:center; }
.email-quote-toggle > summary::-webkit-details-marker { display:none; }
.email-quote-toggle > summary::before { content:'•••'; }
.email-quote-content { display:flow-root; }
html.mf-dense p { margin-top:0; }
${rootTag} { display:block; font:14px/1.5 Arial,sans-serif; color:#202124; background:#fff; color-scheme:light; }
${bodyTag} { display:block; }
html.mf-dark ${rootTag}, html.mf-dense ${rootTag} { background:transparent; }`;
}

function escapeAttribute(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * The srcdoc for one message. The CSP meta comes first so it governs every
 * element after it; `<base target>` sends any link the sanitizer left without
 * a target to a new tab instead of navigating the frame.
 */
export function buildEmailFrameDocument({ html, csp, style, dir, classes }: EmailFrameDocumentOptions): string {
	const className = classes.filter(Boolean).join(" ");
	return "<!doctype html>"
		+ `<html dir="${escapeAttribute(dir || "ltr")}"${className ? ` class="${escapeAttribute(className)}"` : ""}>`
		+ "<head><meta charset=\"utf-8\">"
		+ `<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(csp)}">`
		+ "<meta name=\"referrer\" content=\"no-referrer\">"
		+ "<base target=\"_blank\">"
		+ `<style>${style.replace(/<\/style/gi, "<\\/style")}</style>`
		+ `</head><body>${html}</body></html>`;
}

/**
 * What a click on a link inside the frame should do. Web links open in a new
 * tab on their own (`target=_blank`, popups escape the sandbox); fragments
 * scroll within the message and mailto:/tel: go to the system handler from the
 * app window, since a sandboxed popup would leave an empty tab behind.
 */
export function classifyEmailFrameLink(href: string | null | undefined): EmailFrameLinkAction {
	if (!href) return { kind: "none" };
	if (href.startsWith("#")) {
		let id = href.slice(1);
		try { id = decodeURIComponent(id); } catch { /* Keep the raw fragment. */ }
		return { kind: "fragment", id };
	}
	if (/^(?:mailto|tel):/i.test(href)) return { kind: "handler", href };
	if (/^https?:/i.test(href)) return { kind: "external" };
	return { kind: "none" };
}

/** Height that shows the whole body, including a horizontal scrollbar. */
export function emailFrameHeight({ scrollHeight, offsetHeight, clientHeight }: EmailFrameMetrics): number {
	return Math.max(0, Math.ceil(scrollHeight + Math.max(0, offsetHeight - clientHeight)));
}

/**
 * Keys pressed inside the frame do not reach the app's shortcut listeners on
 * window, so they are re-dispatched on the iframe element. Tab stays native so
 * focus moves through the links in the message and out of it as usual.
 */
export function shouldForwardFrameKey(event: Pick<KeyboardEvent, "key" | "isComposing">): boolean {
	return event.key !== "Tab" && !event.isComposing;
}

export function forwardedKeyboardEventInit(event: Pick<KeyboardEvent, "key" | "code" | "location" | "repeat" | "ctrlKey" | "shiftKey" | "altKey" | "metaKey">): KeyboardEventInit {
	return {
		key: event.key,
		code: event.code,
		location: event.location,
		repeat: event.repeat,
		ctrlKey: event.ctrlKey,
		shiftKey: event.shiftKey,
		altKey: event.altKey,
		metaKey: event.metaKey,
		bubbles: true,
		cancelable: true,
		composed: true,
	};
}
