"use client";

import { useLanguage } from "@/components/language-provider";
import { useEffect, useRef, useState } from "react";
import { prepareReaderEmailHtml } from "@/lib/remote-images/reader";
import { collapseQuotedEmailHtml } from "@/app/(dashboard)/inbox/[messageId]/quote-collapse-utils";
import {
	EMAIL_FRAME_SANDBOX,
	buildEmailFrameCsp,
	buildEmailFrameDocument,
	classifyEmailFrameLink,
	emailFrameHeight,
	forwardedKeyboardEventInit,
	frameBaseStyle,
	shouldForwardFrameKey,
} from "./email-html-renderer-utils";

/**
 * Mail HTML is sanitized (DOMPurify) and then shown in a sandboxed iframe
 * without allow-scripts, under its own restrictive CSP. The frame shares the
 * app origin so cid: and proxied images carry the session cookie; everything
 * the reader does with the mail (height, links, theme, shortcuts) is driven
 * from this component, since no script runs inside the frame.
 */
export function EmailHtmlRenderer({ html, className, dense = false, preserveLeadingQuote = false, autoAllowRemote = false, onAllowRemote }: {
	html: string; className?: string;
	/** Tighter block spacing for short internal text such as notes. */
	dense?: boolean;
	preserveLeadingQuote?: boolean;
	/** Load remote content without a click; the reader can still block it. */
	autoAllowRemote?: boolean;
	/** Called when the reader chooses to load remote content. */
	onAllowRemote?: () => void;
}) {
	const { t } = useLanguage();
	const quoteToggleLabel = t("message.quote.toggle");
	const frame = useRef<HTMLIFrameElement>(null);
	const [height, setHeight] = useState(0);
	const [choice, setChoice] = useState<{ source: string; allow: boolean } | null>(null);
	const [hasRemote, setHasRemote] = useState(false);
	const allowRemote = choice?.source === html ? choice.allow : autoAllowRemote;
	// Mail is authored for white paper. Under the dark theme it is inverted
	// (images inverted back) instead of glaring as a white slab.
	useEffect(() => {
		const root = document.documentElement;
		const sync = () => frame.current?.contentDocument?.documentElement.classList.toggle("mf-dark", root.classList.contains("dark"));
		const observer = new MutationObserver(sync);
		observer.observe(root, { attributes: true, attributeFilter: ["class"] });
		return () => observer.disconnect();
	}, []);
	useEffect(() => {
		const element = frame.current;
		if (!element) return;
		const appRoot = document.documentElement;
		const proxyRemote = appRoot.dataset.remoteImageProxy !== "disabled";
		const prepared = prepareReaderEmailHtml(html, { reader: true, allowRemote, proxyRemote });
		setHasRemote(prepared.hasRemote);
		const previous = element.contentDocument;
		element.srcdoc = buildEmailFrameDocument({
			html: collapseQuotedEmailHtml(prepared.html, preserveLeadingQuote, quoteToggleLabel) ?? "",
			csp: buildEmailFrameCsp({ origin: window.location.origin, directRemote: allowRemote && !proxyRemote }),
			style: frameBaseStyle(prepared.rootTag, prepared.bodyTag),
			dir: appRoot.dir || "ltr",
			classes: [appRoot.classList.contains("dark") && "mf-dark", dense && "mf-dense"],
		});

		let disposed = false;
		let attached: Document | null = null;
		let pending = 0;
		const cleanups: Array<() => void> = [];
		const measure = () => {
			if (pending) return;
			pending = window.requestAnimationFrame(() => {
				pending = 0;
				const body = attached?.body;
				if (!body || disposed) return;
				setHeight(emailFrameHeight(body));
			});
		};
		const listen = (target: EventTarget, type: string, listener: (event: Event) => void, capture = false) => {
			target.addEventListener(type, listener, capture);
			cleanups.push(() => target.removeEventListener(type, listener, capture));
		};
		const attach = (doc: Document) => {
			if (disposed || attached === doc || !doc.body) return;
			attached = doc;
			// An LTR scroller cannot reach left-side overflow from an RTL email.
			const mailBody = doc.querySelector(prepared.bodyTag);
			if (mailBody) doc.body.dir = doc.defaultView?.getComputedStyle(mailBody).direction ?? doc.body.dir;
			doc.documentElement.classList.toggle("mf-dark", appRoot.classList.contains("dark"));
			const resize = new ResizeObserver(measure);
			resize.observe(doc.body);
			resize.observe(element);
			cleanups.push(() => resize.disconnect());
			// Late images and opened quotes change the height after the first layout.
			listen(doc, "load", measure, true);
			listen(doc, "error", measure, true);
			listen(doc, "toggle", measure, true);
			listen(doc, "click", event => {
				const mouse = event as MouseEvent;
				if (mouse.button !== 0 || mouse.ctrlKey || mouse.metaKey || mouse.shiftKey || mouse.altKey) return;
				const anchor = (event.target as Element | null)?.closest?.("a[href], area[href]");
				const action = classifyEmailFrameLink(anchor?.getAttribute("href"));
				if (action.kind === "fragment") {
					event.preventDefault();
					const destination = doc.getElementById(action.id) ?? Array.from(doc.querySelectorAll("a[name]")).find(node => node.getAttribute("name") === action.id);
					destination?.scrollIntoView({ block: "start" });
				} else if (action.kind === "handler") {
					event.preventDefault();
					window.location.href = action.href;
				}
			});
			listen(doc, "keydown", event => {
				const key = event as KeyboardEvent;
				if (!shouldForwardFrameKey(key)) return;
				const forwarded = new KeyboardEvent("keydown", forwardedKeyboardEventInit(key));
				if (!element.dispatchEvent(forwarded)) key.preventDefault();
			});
			measure();
		};
		// The new document is ready long before its load event, which waits for
		// eager images; poll a few frames so the text shows without that wait.
		const poll = () => {
			const doc = element.contentDocument;
			if (doc && doc !== previous && doc.URL === "about:srcdoc" && doc.readyState !== "loading") attach(doc);
			else if (!disposed) pollFrame = window.requestAnimationFrame(poll);
		};
		let pollFrame = window.requestAnimationFrame(poll);
		const onLoad = () => {
			if (element.contentDocument) attach(element.contentDocument);
			measure();
		};
		element.addEventListener("load", onLoad);
		return () => {
			disposed = true;
			window.cancelAnimationFrame(pollFrame);
			if (pending) window.cancelAnimationFrame(pending);
			element.removeEventListener("load", onLoad);
			for (const cleanup of cleanups) cleanup();
		};
	}, [html, allowRemote, dense, preserveLeadingQuote, quoteToggleLabel]);
	return <div className={`min-w-0 max-w-full ${className ?? ""}`}>
		{hasRemote && <div className="mb-2 flex justify-end">
			{/* The label names the action, so it is not also an aria-pressed toggle. */}
			<button type="button" className="rounded px-2 py-1 text-xs text-blue-600 hover:bg-blue-50"
				onClick={() => {
					if (!allowRemote) onAllowRemote?.();
					setChoice({ source: html, allow: !allowRemote });
				}}>
				{allowRemote ? t("message.blockRemote") : t("message.allowRemote")}
			</button>
		</div>}
		{/* The frame's own light scheme must match its element's, or Chrome paints an opaque backdrop behind transparent mail. */}
		<iframe ref={frame} title={t("message.frameTitle")} sandbox={EMAIL_FRAME_SANDBOX}
			className="block w-full max-w-full border-0" style={{ height, colorScheme: "light" }} />
	</div>;
}
