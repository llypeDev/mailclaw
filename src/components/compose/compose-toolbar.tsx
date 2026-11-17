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
			<div className="flex items-center max-md:order-last max-md:ml-auto">
				<Button
					type="submit"
					size="sm"
					disabled={disabled}
					className="rounded-r-none px-4 max-md:h-10 max-md:px-5 max-md:text-[15px]"
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
			{/* <span className="mx-1 h-5 w-px bg-neutral-200" /> */}
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
					className="rounded-md p-1.5 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 disabled:pointer-events-none disabled:opacity-50 max-md:px-2"
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
						"rounded-md p-1.5 hover:bg-neutral-100 disabled:pointer-events-none disabled:opacity-50 max-md:px-2",
						trackOpens ? "text-blue-600 hover:text-blue-700" : "text-neutral-500 hover:text-neutral-900",
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
								"rounded-md p-1.5 hover:bg-neutral-100 disabled:pointer-events-none disabled:opacity-50 max-md:px-2",
								followUpDays ? "text-amber-600 hover:text-amber-700" : "text-neutral-500 hover:text-neutral-900",
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
					className="rounded-md p-1.5 text-neutral-500 hover:bg-red-50 hover:text-red-600 disabled:pointer-events-none disabled:opacity-50 max-md:px-2"
				>
					<Trash2 className="h-4 w-4" />
				</button>
			</Tooltip>
		</>
	);
}
