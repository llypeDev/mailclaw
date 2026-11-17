"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useState } from "react";
import { ChevronDown, X } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { NewTemplateDialog } from "./new-template-dialog";
import { TemplateMenu } from "./template-menu";
import {
	formatDateTimeLocal,
	formatScheduledSend,
	getScheduleSendOptions,
	isPastSchedule,
	parseDateTimeLocal,
} from "./schedule-send-utils";
import type { ScheduleSendMenuProps } from "./schedule-send-types";
import { useIsMobile } from "@/components/sidebar-mobile-utils";
import { ScheduleSendSheet } from "./schedule-send-sheet";
import { getUserTimeZone } from "@/lib/time/utils";
import { buttonVariants } from "@/components/ui/button-utils";

/** The chevron half of the Send split button: Orange's primary icon button, divided from Send by a lighter edge. */
const TRIGGER_CLASS = `${buttonVariants({ size: "roundedSM" })} border-s-on-accent/30 max-md:h-10 max-md:w-10`;

export function ScheduleSendMenu({ disabled, value, onChange, mailboxId, from, onApplyTemplate }: ScheduleSendMenuProps) {
	const { t } = useLanguage();
	const [newTemplateOpen, setNewTemplateOpen] = useState(false);
	const [sheetOpen, setSheetOpen] = useState(false);
	const isPhone = useIsMobile();
	const [pickedText, setPickedText] = useState<string | null>(null);
	// The picker's lower bound, read when the menu opens and on every edit rather than during render.
	const [minText, setMinText] = useState(() => formatDateTimeLocal(new Date()));
	const options = getScheduleSendOptions();
	const picked = pickedText === null ? null : parseDateTimeLocal(pickedText);
	const pastPicked = picked !== null && isPastSchedule(picked);

	function pick(text: string) {
		const parsed = parseDateTimeLocal(text);
		setMinText(formatDateTimeLocal(new Date()));
		setPickedText(text);
		if (!parsed) onChange(null);
		else if (!isPastSchedule(parsed)) onChange(parsed);
	}

	if (isPhone) {
		return (
			<>
				<button type="button" disabled={disabled} aria-label={t("schedule.optionsLabel")} onClick={() => setSheetOpen(true)} className={TRIGGER_CLASS}>
					<ChevronDown className="h-4 w-4" />
				</button>
				<ScheduleSendSheet open={sheetOpen} onOpenChange={setSheetOpen} value={value} onChange={onChange} onApplyTemplate={onApplyTemplate} onNewTemplate={() => setNewTemplateOpen(true)} />
				<NewTemplateDialog open={newTemplateOpen} onOpenChange={setNewTemplateOpen} mailboxId={mailboxId} from={from} />
			</>
		);
	}

	return (
		<>
		<DropdownMenu.Root onOpenChange={(open) => { setPickedText(null); if (open) setMinText(formatDateTimeLocal(new Date())); }}>
			<DropdownMenu.Trigger
				type="button"
				disabled={disabled}
				aria-label={t("schedule.optionsLabel")}
				className={TRIGGER_CLASS}
			>
				<ChevronDown className="h-4 w-4" />
			</DropdownMenu.Trigger>
			<DropdownMenu.Portal>
				<DropdownMenu.Content
					align="start"
					sideOffset={6}
					className="z-50 min-w-56 border border-line-strong bg-surface-raised p-1 text-sm text-fg shadow-lg"
				>
					<TemplateMenu onApply={onApplyTemplate} onNew={() => setNewTemplateOpen(true)} />
					<DropdownMenu.Separator className="my-1 h-px bg-line-subtle" />
					<DropdownMenu.Label className="px-3 pb-1 pt-2 font-display text-xs font-medium uppercase tracking-wider text-fg-subtle">{t("schedule.heading")}</DropdownMenu.Label>
					{value && (
						<>
							<DropdownMenu.Item
								onSelect={() => onChange(null)}
								className="flex cursor-pointer items-center px-3 py-2 outline-none hover:bg-surface-hover focus:bg-surface-hover"
							>
								<X className="me-2 h-4 w-4" />
								{t("schedule.clear")}
							</DropdownMenu.Item>
							<DropdownMenu.Separator className="my-1 h-px bg-line-subtle" />
						</>
					)}
					{options.map((option) => (
						<DropdownMenu.Item
							key={option.labelKey}
							onSelect={() => onChange(option.value)}
							className="cursor-pointer px-3 py-2 outline-none hover:bg-surface-hover focus:bg-surface-hover"
						>
							{t(option.labelKey)}
							<span className="ms-2 font-mono text-xs text-fg-subtle">
								{option.value && formatScheduledSend(option.value)}
							</span>
						</DropdownMenu.Item>
					))}
					<DropdownMenu.Separator className="my-1 h-px bg-line-subtle" />
					<DropdownMenu.Label className="px-3 pb-1 pt-2 font-display text-xs font-medium uppercase tracking-wider text-fg-subtle">
						{t("schedule.pick", { timeZone: getUserTimeZone() })}
					</DropdownMenu.Label>
					<input
						type="datetime-local"
						min={minText}
						value={pickedText ?? (value ? formatDateTimeLocal(value) : "")}
						onChange={(event) => pick(event.target.value)}
						onKeyDown={(event) => event.stopPropagation()}
						aria-invalid={pastPicked}
						aria-describedby={pastPicked ? "schedule-past-time" : undefined}
						className="mx-2 mb-2 h-9 border border-line-control bg-surface px-2 text-sm text-fg outline-none focus:border-focus focus-visible:outline-2 focus-visible:outline-focus aria-[invalid=true]:border-danger"
					/>
					{pastPicked && <p id="schedule-past-time" role="alert" className="mx-2 mb-2 text-xs text-danger-text">{t("schedule.pastTime")}</p>}
				</DropdownMenu.Content>
			</DropdownMenu.Portal>
		</DropdownMenu.Root>
		<NewTemplateDialog open={newTemplateOpen} onOpenChange={setNewTemplateOpen} mailboxId={mailboxId} from={from} />
		</>
	);
}
