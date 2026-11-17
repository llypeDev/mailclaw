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
					className="flex max-w-full shrink-0 items-center gap-2 rounded-lg bg-neutral-100 px-2 py-1 text-xs"
					title={t("compose.carriedOver")}
				>
					<FileText className="h-4 w-4 shrink-0 text-neutral-500" />
					<span className="max-w-48 truncate">{attachment.filename}</span>
					<span className="text-xs text-neutral-500">{formatAttachmentSize(attachment.size)}</span>
					<button
						type="button"
						onClick={() => onRemoveStored(attachment.id)}
						className="rounded-full p-1 text-neutral-500 hover:bg-neutral-200 hover:text-neutral-700"
					>
						<X className="h-3.5 w-3.5" />
						<span className="sr-only">{t("compose.removeAttachment")}</span>
					</button>
				</div>
			))}
			{attachments.map((attachment) => (
				<div
					key={attachment.id}
					className="flex max-w-full shrink-0 items-center gap-2 rounded-lg bg-neutral-100 px-2 py-1 text-xs"
				>
					<FileText className="h-4 w-4 shrink-0 text-neutral-500" />
					<span className="max-w-48 truncate font-medium">{attachment.file.name}</span>
					<span className="text-xs text-neutral-500">
						{formatAttachmentSize(attachment.file.size)}
					</span>
					<button
						type="button"
						onClick={() => onRemove(attachment.id)}
						className="rounded-full p-1 text-neutral-500 hover:bg-neutral-200 hover:text-neutral-700"
					>
						<X className="h-3.5 w-3.5" />
						<span className="sr-only">{t("compose.removeAttachment")}</span>
					</button>
				</div>
			))}
		</div>
		<p className="px-3 pb-2 text-xs text-amber-700">{sizes.some((size) => size > cloudThresholdBytes) ? t("compose.cloudWarning.will") : t("compose.cloudWarning.may")}</p>
		</div>
	);
}
