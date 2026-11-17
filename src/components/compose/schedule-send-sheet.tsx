"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useEffect, useRef, useState } from "react";
import { CalendarClock, ChevronLeft, ChevronRight, FileText, Plus, X } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/components/language-provider";
import { authFetch } from "@/lib/auth/client";
import { cn } from "@/lib/utils";
import { getUserTimeZone } from "@/lib/time/utils";
import { textToHtml } from "./rich-text-utils";
import { formatDateTimeLocal, formatScheduledSend, getScheduleSendOptions, isPastSchedule, parseDateTimeLocal } from "./schedule-send-utils";
import type { ScheduleSendSheetProps } from "./schedule-send-types";
import type { ComposeTemplate } from "./template-types";

type Page = "root" | "date" | "templates";
const PAGES: Page[] = ["root", "date", "templates"];

const pageClass = "flex max-h-[calc(85dvh-3.5rem)] w-full shrink-0 flex-col px-2 pb-3";

const rowClass = "flex min-h-12 w-full items-center gap-3 px-3 text-start text-base text-fg hover:bg-surface-hover active:bg-surface-active focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus";

/** Phone version of the Send options menu: a bottom sheet whose pages slide in (root → date, templates). */
export function ScheduleSendSheet({ open, onOpenChange, value, onChange, allowClear = true, onApplyTemplate, onNewTemplate }: ScheduleSendSheetProps) {
	const { t } = useLanguage();
	const [page, setPage] = useState<Page>("root");
	const [templates, setTemplates] = useState<ComposeTemplate[]>([]);
	const [draftDate, setDraftDate] = useState("");
	const pageRefs = useRef<Record<Page, HTMLDivElement | null>>({ root: null, date: null, templates: null });
	const [height, setHeight] = useState<number | undefined>(undefined);

	// The sheet is as tall as the page showing, and eases between heights as pages slide.
	useEffect(() => {
		const element = pageRefs.current[page];
		if (!open || !element) return;
		const measure = () => setHeight(element.offsetHeight);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => observer.disconnect();
	}, [open, page, templates.length, value]);

	const showTemplates = !!(onApplyTemplate && onNewTemplate);

	useEffect(() => {
		if (!open) return;
		setPage("root");
		setDraftDate(value ? formatDateTimeLocal(value) : "");
		if (!showTemplates) return;
		void authFetch("/api/templates", { cache: "no-store" })
			.then(async (response) => {
				if (response.ok) setTemplates(((await response.json()) as { templates: ComposeTemplate[] }).templates);
			})
			.catch(() => {});
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open]);

	const options = getScheduleSendOptions();
	const minimum = formatDateTimeLocal(new Date());
	const parsedDate = parseDateTimeLocal(draftDate);
	const pastDate = parsedDate !== null && isPastSchedule(parsedDate);
	const title = page === "date" ? t("schedule.pick", { timeZone: getUserTimeZone() }) : page === "templates" ? t("template.menu") : t("schedule.heading");

	function choose(date: Date | null) {
		onChange(date);
		onOpenChange(false);
	}

	return (
		<DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Overlay className="slide-sheet-overlay fixed inset-0 z-[70] bg-overlay" />
				<DialogPrimitive.Content
					aria-label={t("schedule.optionsLabel")}
					aria-describedby={undefined}
					className="slide-sheet fixed inset-x-0 bottom-0 z-[70] max-h-[85dvh] overflow-hidden border-t border-line-strong bg-surface-raised pb-[env(safe-area-inset-bottom)] text-fg shadow-lg outline-none"
				>
					<div className="flex h-14 items-center gap-1 border-b border-line-subtle px-2">
						{page === "root" ? <span className="w-10" /> : (
							<button type="button" onClick={() => setPage("root")} className="flex h-10 w-10 items-center justify-center text-fg-muted hover:bg-surface-hover active:bg-surface-active">
								<ChevronLeft className="h-6 w-6 rtl:rotate-180" />
								<span className="sr-only">{t("schedule.heading")}</span>
							</button>
						)}
						<DialogPrimitive.Title className="flex-1 truncate text-center font-display text-base font-semibold text-fg">{title}</DialogPrimitive.Title>
						<DialogPrimitive.Close className="flex h-10 w-10 items-center justify-center text-fg-muted hover:bg-surface-hover active:bg-surface-active">
							<X className="h-5 w-5" />
							<span className="sr-only">{t("navigation.close")}</span>
						</DialogPrimitive.Close>
					</div>
					<div className="overflow-hidden transition-[height] duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none" style={{ height }}>
						<div className="flex items-start transition-transform duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none" style={{ transform: `translateX(-${PAGES.indexOf(page) * 100}%)` }}>
							<div ref={(node) => { pageRefs.current.root = node; }} className={pageClass} inert={page !== "root"}>
								<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
									{allowClear && value && (
										<button type="button" onClick={() => choose(null)} className={rowClass}>
											<X className="h-5 w-5 text-fg-subtle" />
											{t("schedule.clear")}
										</button>
									)}
									{options.map((option) => (
										<button key={option.labelKey} type="button" onClick={() => choose(option.value)} className={cn(rowClass, "justify-between")}>
											<span className="text-start">{t(option.labelKey)}</span>
											{/* The monospaced date keeps one line; a long label wraps instead. */}
											<span className="shrink-0 whitespace-nowrap font-mono text-sm text-fg-subtle">{option.value && formatScheduledSend(option.value)}</span>
										</button>
									))}
								</div>
								<div className="shrink-0 pt-2">
									<button type="button" onClick={() => setPage("date")} className={cn(rowClass, "justify-between")}>
										<span className="flex items-center gap-3"><CalendarClock className="h-5 w-5 text-fg-subtle" />{t("schedule.pick", { timeZone: getUserTimeZone() })}</span>
										<ChevronRight className="h-5 w-5 text-fg-subtle rtl:rotate-180" />
									</button>
									{showTemplates && (
										<button type="button" onClick={() => setPage("templates")} className={cn(rowClass, "justify-between")}>
											<span className="flex items-center gap-3"><FileText className="h-5 w-5 text-fg-subtle" />{t("template.menu")}</span>
											<ChevronRight className="h-5 w-5 text-fg-subtle rtl:rotate-180" />
										</button>
									)}
								</div>
							</div>
							<div ref={(node) => { pageRefs.current.date = node; }} className={pageClass} inert={page !== "date"}>
								<div className="min-h-0 flex-1 overflow-y-auto px-2">
									<input
										type="datetime-local"
										min={minimum}
										value={draftDate}
										onChange={(event) => setDraftDate(event.target.value)}
										aria-label={t("schedule.pick", { timeZone: getUserTimeZone() })}
										aria-invalid={pastDate}
										aria-describedby={pastDate ? "schedule-past-time" : undefined}
										className="h-12 w-full border border-line-control bg-surface px-3 text-base text-fg outline-none focus:border-focus focus-visible:outline-2 focus-visible:outline-focus aria-[invalid=true]:border-danger"
									/>
									{pastDate && <p id="schedule-past-time" role="alert" className="mt-2 text-sm text-danger-text">{t("schedule.pastTime")}</p>}
								</div>
								<div className="shrink-0 px-2 pt-4">
									<Button type="button" className="h-12 w-full text-base" disabled={!parsedDate || pastDate} onClick={() => choose(parsedDate)}>
										{t("schedule.heading")}
									</Button>
								</div>
							</div>
							{showTemplates && (
								<div ref={(node) => { pageRefs.current.templates = node; }} className={pageClass} inert={page !== "templates"}>
									<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
										{templates.length === 0 && <p className="px-3 py-3 text-sm text-fg-subtle">{t("template.none")}</p>}
										{templates.map((template) => (
											<button
												key={template.id}
												type="button"
												onClick={() => {
													onApplyTemplate?.({ title: template.subject ?? "", html: template.htmlBody ?? textToHtml(template.textBody ?? "") });
													onOpenChange(false);
												}}
												className={rowClass}
											>
												<span className="break-words">{template.subject || t("template.untitled")}</span>
											</button>
										))}
									</div>
									<div className="shrink-0 pt-2">
										<button type="button" onClick={() => { onOpenChange(false); onNewTemplate?.(); }} className={cn(rowClass, "text-accent-text")}>
											<Plus className="h-5 w-5" />{t("template.new")}
										</button>
									</div>
								</div>
							)}
						</div>
					</div>
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
}
