"use client";

import { useEffect, useRef, useState } from "react";
import type { ClipboardEvent, KeyboardEvent } from "react";
import {
	Bold,
	Italic,
	Link2,
	List,
	ListOrdered,
	Quote,
	RemoveFormatting,
	Strikethrough,
	Underline,
} from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { Tooltip } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { EmailHtmlRenderer } from "@/components/messages/email-html-renderer";
import { sanitizeEmailHtml, sanitizeEditorHtml } from "@/lib/email/html";
import type { RichTextEditorProps, ToolbarCommand } from "./rich-text-editor-types";

const COMMANDS: ToolbarCommand[] = [
	{ command: "bold", labelKey: "editor.bold", icon: Bold },
	{ command: "italic", labelKey: "editor.italic", icon: Italic },
	{ command: "underline", labelKey: "editor.underline", icon: Underline },
	{ command: "strikeThrough", labelKey: "editor.strikethrough", icon: Strikethrough },
	{ command: "insertUnorderedList", labelKey: "editor.bulletedList", icon: List },
	{ command: "insertOrderedList", labelKey: "editor.numberedList", icon: ListOrdered },
	{ command: "formatBlock", labelKey: "editor.quote", icon: Quote, value: "blockquote" },
];

/** A square formatting button; the pressed state is shown by `aria-pressed` and a darker fill. */
const FORMAT_BUTTON_CLASS = "p-1.5 text-fg-subtle hover:bg-surface-hover hover:text-fg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus disabled:pointer-events-none disabled:text-fg-disabled";

/**
 * A small HTML editor built on contentEditable. It stays deliberately light:
 * inline styles, lists, quotes and links, with pasted content flattened to
 * text so a message never carries another site's markup.
 */
export function RichTextEditor({
	id,
	value,
	onChange,
	quotedHtml,
	disabled,
	placeholder,
	className,
	editableClassName,
	toolbarVisible = true,
	toolbarClassName,
	toolbarStart,
	toolbarEnd,
	footerContent,
}: RichTextEditorProps) {
	const { t } = useLanguage();
	const editorRef = useRef<HTMLDivElement | null>(null);
	const [active, setActive] = useState<Record<string, boolean>>({});
	const [linkOpen, setLinkOpen] = useState(false);
	const [linkUrl, setLinkUrl] = useState("");
	const [showQuoted, setShowQuoted] = useState(false);
	const savedRange = useRef<Range | null>(null);
	const lastEmitted = useRef<string | null>(null);

	// Keep the DOM in step with the value without resetting the caret on every keystroke.
	useEffect(() => {
		const element = editorRef.current;
		if (!element) return;
		if (lastEmitted.current !== null && value === lastEmitted.current) return;
		const safeValue = sanitizeEditorHtml(value);
		if (element.innerHTML !== safeValue) element.innerHTML = safeValue;
		lastEmitted.current = null;
	}, [value]);

	useEffect(() => {
		function refresh() {
			const element = editorRef.current;
			if (!element || !element.contains(document.activeElement)) return;
			const next: Record<string, boolean> = {};
			for (const item of COMMANDS) {
				if (item.command === "formatBlock") {
					next[item.command] = document.queryCommandValue("formatBlock").toLowerCase() === "blockquote";
				} else {
					next[item.command] = document.queryCommandState(item.command);
				}
			}
			setActive(next);
		}
		document.addEventListener("selectionchange", refresh);
		return () => document.removeEventListener("selectionchange", refresh);
	}, []);

	function emit() {
		// Export validated original resource addresses, never the blocked preview placeholders.
		const output = sanitizeEmailHtml(editorRef.current?.innerHTML ?? "", { forOutgoing: true }) ?? "";
		lastEmitted.current = output;
		onChange(output);
	}

	function run(command: string, commandValue?: string) {
		editorRef.current?.focus();
		if (command === "formatBlock" && active.formatBlock) {
			document.execCommand("formatBlock", false, "div");
		} else {
			document.execCommand(command, false, commandValue);
		}
		emit();
	}

	function openLink() {
		const selection = window.getSelection();
		savedRange.current = selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;
		setLinkUrl("");
		setLinkOpen(true);
	}

	function applyLink() {
		const url = linkUrl.trim();
		setLinkOpen(false);
		if (!url) return;
		const href = /^(https?:|mailto:)/i.test(url) ? url : `https://${url}`;
		editorRef.current?.focus();
		const selection = window.getSelection();
		if (savedRange.current && selection) {
			selection.removeAllRanges();
			selection.addRange(savedRange.current);
		}
		if (selection && selection.isCollapsed) {
			// The URL field is untrusted text: build the anchor with DOM APIs so it is never parsed as HTML.
			const anchor = document.createElement("a");
			anchor.setAttribute("href", href);
			anchor.textContent = href;
			document.execCommand("insertHTML", false, anchor.outerHTML);
		} else {
			document.execCommand("createLink", false, href);
		}
		emit();
	}

	function onPaste(event: ClipboardEvent<HTMLDivElement>) {
		event.preventDefault();
		const text = event.clipboardData.getData("text/plain");
		document.execCommand("insertText", false, text);
	}

	function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
		if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
			event.preventDefault();
			openLink();
		}
	}

	const formatButtons = (
		<>
		{COMMANDS.map((item) => (
			<Tooltip key={item.command} label={t(item.labelKey)}>
				<button
					type="button"
					aria-label={t(item.labelKey)}
					aria-pressed={!!active[item.command]}
					disabled={disabled}
					onMouseDown={(event) => event.preventDefault()}
					onClick={() => run(item.command, item.value)}
					className={cn(
						FORMAT_BUTTON_CLASS,
						active[item.command] && "bg-surface-active text-fg",
					)}
				>
					<item.icon className="h-4 w-4" />
				</button>
			</Tooltip>
		))}
		<Tooltip label={t("editor.insertLinkHint")}>
			<button
				type="button"
				aria-label={t("editor.insertLink")}
				disabled={disabled}
				onMouseDown={(event) => event.preventDefault()}
				onClick={openLink}
				className={FORMAT_BUTTON_CLASS}
			>
				<Link2 className="h-4 w-4" />
			</button>
		</Tooltip>
		<Tooltip label={t("editor.clearFormatting")}>
			<button
				type="button"
				aria-label={t("editor.clearFormatting")}
				disabled={disabled}
				onMouseDown={(event) => event.preventDefault()}
				onClick={() => run("removeFormat")}
				className={FORMAT_BUTTON_CLASS}
			>
				<RemoveFormatting className="h-4 w-4" />
			</button>
		</Tooltip>
		</>
	);

	return (
		<div className={cn("flex min-h-0 flex-1 flex-col", className)}>
			{/* On phones the formatting buttons stick above the text, on the surface the host names in `--editor-surface`. */}
			<div className={cn("sticky top-0 z-10 flex shrink-0 items-center gap-0.5 overflow-x-auto bg-[color:var(--editor-surface,var(--color-surface))] px-2 py-1 md:hidden", !toolbarVisible && "hidden")}>{formatButtons}</div>
			<div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto">
				<div
					ref={editorRef}
					id={id}
					role="textbox"
					aria-multiline="true"
					aria-label={t("editor.messageBody")}
					contentEditable={!disabled}
					suppressContentEditableWarning
					data-placeholder={placeholder}
					onInput={emit}
					onBlur={emit}
					onPaste={onPaste}
					onKeyDown={onKeyDown}
					className={cn(
						// Typed text follows the theme (cream on charcoal in the dark themes); `.email-body` restores lists and quotes.
						"email-body max-w-none bg-transparent px-4 py-3 text-sm text-fg outline-none",
						"min-h-32 grow shrink-0 empty:before:pointer-events-none empty:before:text-fg-subtle empty:before:content-[attr(data-placeholder)]",
						disabled && "cursor-not-allowed opacity-60",
						editableClassName,
					)}
				/>
				{quotedHtml && (
					<div className="shrink-0 px-4 pb-3">
						<button
							type="button"
							onClick={() => setShowQuoted((open) => !open)}
							aria-expanded={showQuoted}
							aria-label={showQuoted ? t("editor.hideQuoted") : t("editor.showQuoted")}
							className="border border-line bg-canvas-subtle px-2 text-xs leading-5 text-fg-subtle hover:bg-surface-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-focus"
							title={showQuoted ? t("editor.hideQuoted") : t("editor.showQuoted")}
						>
							•••
						</button>
						{showQuoted && (
							<EmailHtmlRenderer className="mt-2" html={quotedHtml} preserveLeadingQuote />
						)}
					</div>
				)}
			</div>
			{footerContent}
			<div
				inert={!toolbarVisible}
				className="relative grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none"
				style={{ gridTemplateRows: toolbarVisible ? "1fr" : "0fr" }}
			>
				<div className="min-h-0 overflow-hidden">
					<div className={cn("relative flex items-center gap-0.5 max-md:gap-2 border-t border-line-subtle px-4 py-3 max-md:border-t-0", toolbarClassName)}>
						{toolbarStart}
						<div className="contents max-md:hidden">{formatButtons}</div>
						{toolbarEnd}
					</div>
				</div>
				{linkOpen && toolbarVisible && (
					<div
						className="absolute bottom-full start-2 z-10 mb-1 flex items-center gap-2 border border-line-strong bg-surface-raised p-2 shadow-lg"
					>
						<input
							autoFocus
							value={linkUrl}
							onChange={(event) => setLinkUrl(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter") {
									event.preventDefault();
									applyLink();
								}
								if (event.key === "Escape") setLinkOpen(false);
							}}
							placeholder="https://example.com"
							aria-label={t("editor.insertLink")}
							className="h-8 w-64 border border-line-control bg-surface px-2 text-sm text-fg outline-none placeholder:text-fg-subtle focus:border-focus focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-focus"
						/>
						<Button type="button" size="sm" onClick={applyLink}>
							{t("editor.apply")}
						</Button>
					</div>
				)}
			</div>
		</div>
	);
}
