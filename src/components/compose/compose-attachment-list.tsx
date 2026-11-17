"use client";

import { FileText, X } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { formatAttachmentSize } from "@/components/compose/utils";
import type { ComposeAttachment, ComposeStoredAttachment } from "./types";

/** The attachment chips under the body, with the warning about large files going out as links. */
export function ComposeAttachmentList({
	attachments,
	storedAttachments,
	cloudThresholdBytes,
	onRemove,
	onRemoveStored,
}: {
	attachments: ComposeAttachment[];
	storedAttachments: ComposeStoredAttachment[];
	cloudThresholdBytes: number;
	onRemove: (id: string) => void;
	onRemoveStored: (id: string) => void;
}) {
	const { t } = useLanguage();
	const sizes = [...attachments.map((item) => item.file.size), ...storedAttachments.map((item) => item.size)];
	return (
		<div>
		<div className="flex min-w-0 flex-nowrap gap-2 overflow-x-auto overflow-y-hidden px-3 py-2">
			{storedAttachments.map((attachment) => (
				<div
					key={attachment.id}
					className="flex max-w-full shrink-0 items-center gap-2 border border-line bg-canvas-subtle px-2 py-1 text-xs text-fg"
					title={t("compose.carriedOver")}
				>
					<FileText className="h-4 w-4 shrink-0 text-fg-subtle" />
					<span className="max-w-48 truncate">{attachment.filename}</span>
					<span className="font-mono text-xs text-fg-subtle">{formatAttachmentSize(attachment.size)}</span>
					<button
						type="button"
						onClick={() => onRemoveStored(attachment.id)}
						className="p-1 text-fg-subtle hover:bg-surface-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-focus"
					>
						<X className="h-3.5 w-3.5" />
						<span className="sr-only">{t("compose.removeAttachment")}</span>
					</button>
				</div>
			))}
			{attachments.map((attachment) => (
				<div
					key={attachment.id}
					className="flex max-w-full shrink-0 items-center gap-2 border border-line bg-canvas-subtle px-2 py-1 text-xs text-fg"
				>
					<FileText className="h-4 w-4 shrink-0 text-fg-subtle" />
					<span className="max-w-48 truncate font-medium">{attachment.file.name}</span>
					<span className="font-mono text-xs text-fg-subtle">
						{formatAttachmentSize(attachment.file.size)}
					</span>
					<button
						type="button"
						onClick={() => onRemove(attachment.id)}
						className="p-1 text-fg-subtle hover:bg-surface-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-focus"
					>
						<X className="h-3.5 w-3.5" />
						<span className="sr-only">{t("compose.removeAttachment")}</span>
					</button>
				</div>
			))}
		</div>
		<p className="px-3 pb-2 text-xs text-warning-text">{sizes.some((size) => size > cloudThresholdBytes) ? t("compose.cloudWarning.will") : t("compose.cloudWarning.may")}</p>
		</div>
	);
}
