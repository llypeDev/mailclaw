"use client";

import type { RefObject } from "react";
import { BellRing, Eye, EyeOff, Paperclip, Trash2 } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
import { FollowUpMenu } from "@/components/follow-ups/follow-up-menu";
import { followUpOptionKey } from "@/components/follow-ups/follow-up-client-utils";
import { ScheduleSendMenu } from "@/components/compose/schedule-send-menu";
import { cn } from "@/lib/utils";

/** A square icon button in the editor toolbar. */
const TOOL_BUTTON_CLASS = "p-1.5 hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-focus disabled:pointer-events-none disabled:text-fg-disabled max-md:px-2";

/** Start of the editor toolbar: Cancel (phones only), Send and the schedule/template menu. */
export function ComposeSendControls({
	sendLabel,
	disabled,
	onCancel,
	scheduledAt,
	onScheduleChange,
	mailboxId,
	from,
	onApplyTemplate,
}: {
	sendLabel: string;
	disabled: boolean;
	onCancel: () => void;
	scheduledAt: Date | null;
	onScheduleChange: (value: Date | null) => void;
	mailboxId: string | undefined;
	from: string;
	onApplyTemplate: (template: { title: string; html: string }) => void;
}) {
	const { t } = useLanguage();
	return (
		<div className="flex items-center max-md:contents">
			<Button type="button" variant="secondary" size="sm" onClick={onCancel} className="md:hidden max-md:h-10 max-md:px-3.5 max-md:text-[15px]">
				{t("common.cancel")}
			</Button>
			<div className="flex items-center max-md:order-last max-md:ms-auto">
				<Button
					type="submit"
					size="sm"
					disabled={disabled}
					className="px-4 max-md:h-10 max-md:px-5 max-md:text-[15px]"
				>
					{sendLabel}
				</Button>
				<ScheduleSendMenu
					disabled={disabled}
					value={scheduledAt}
					onChange={onScheduleChange}
					mailboxId={mailboxId}
					from={from}
					onApplyTemplate={onApplyTemplate}
				/>
			</div>
		</div>
	);
}

/** End of the editor toolbar: attach, read receipt, follow-up reminder and discard. */
export function ComposeToolbarActions({
	attachmentInput,
	onAddFiles,
	maxAttachmentMb,
	disabled,
	trackOpens,
	onTrackOpensChange,
	followUpDays,
	onFollowUpChange,
	deleteDisabled,
	onDeleteDraft,
}: {
	attachmentInput: RefObject<HTMLInputElement | null>;
	onAddFiles: (files: FileList | null) => void;
	maxAttachmentMb: number;
	disabled: boolean;
	trackOpens: boolean;
	onTrackOpensChange: (next: boolean) => void;
	followUpDays: number | null;
	onFollowUpChange: (days: number | null) => void;
	deleteDisabled: boolean;
	onDeleteDraft: () => void;
}) {
	const { t } = useLanguage();
	return (
		<>
			<Input
				ref={attachmentInput}
				type="file"
				multiple
				className="hidden"
				onChange={(event) => onAddFiles(event.target.files)}
			/>
			<Tooltip label={t("compose.attachTooltip", { max: maxAttachmentMb })}>
				<button
					type="button"
					aria-label={t("compose.attachFiles")}
					onClick={() => attachmentInput.current?.click()}
					disabled={disabled}
					className={cn(TOOL_BUTTON_CLASS, "text-fg-subtle hover:text-fg")}
				>
					<Paperclip className="h-4 w-4" />
				</button>
			</Tooltip>
			<Tooltip label={trackOpens ? t("compose.trackOpensOn") : t("compose.trackOpensOff")}>
				<button
					type="button"
					aria-label={t("compose.trackOpens")}
					aria-pressed={trackOpens}
					onClick={() => onTrackOpensChange(!trackOpens)}
					disabled={disabled}
					className={cn(
						TOOL_BUTTON_CLASS,
						trackOpens ? "bg-accent-subtle text-accent-text hover:bg-accent-subtle" : "text-fg-subtle hover:text-fg",
					)}
				>
					{trackOpens ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
				</button>
			</Tooltip>
			<Tooltip label={followUpDays ? t("followUp.remindOn", { when: t(followUpOptionKey(followUpDays)) }) : t("followUp.remindMe")}>
				<FollowUpMenu
					disabled={disabled}
					onPick={onFollowUpChange}
					onClear={followUpDays ? () => onFollowUpChange(null) : undefined}
					trigger={
						<button
							type="button"
							aria-label={t("followUp.remindMe")}
							className={cn(
								TOOL_BUTTON_CLASS,
								followUpDays ? "bg-warning-subtle text-warning-text hover:bg-warning-subtle" : "text-fg-subtle hover:text-fg",
							)}
						>
							<BellRing className="h-4 w-4" />
						</button>
					}
				/>
			</Tooltip>
			<span className="flex-1 max-md:hidden" />
			<Tooltip label={t("compose.deleteDraft")}>
				<button
					type="button"
					aria-label={t("compose.deleteDraft")}
					onClick={onDeleteDraft}
					disabled={deleteDisabled}
					className={cn(TOOL_BUTTON_CLASS, "text-fg-subtle hover:bg-danger-subtle hover:text-danger-text")}
				>
					<Trash2 className="h-4 w-4" />
				</button>
			</Tooltip>
		</>
	);
}
