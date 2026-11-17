"use client";

import { ArrowDownToLine, Play } from "@/components/icons";
import { formatAttachmentSize } from "@/app/(dashboard)/inbox/[messageId]/utils";
import { useLanguage } from "@/components/language-provider";
import type { MessageAttachmentCardProps } from "./message-attachment-card-types";
import { getAttachmentFileUrl } from "./message-attachment-viewer-utils";
import { getAttachmentVisual } from "./message-attachment-card-utils";

export function MessageAttachmentCard({
	attachment,
	messageId,
	onPreview,
}: MessageAttachmentCardProps) {
	const { t } = useLanguage();
	const visual = getAttachmentVisual(attachment);
	const Icon = visual.icon;
	const previewUrl = getAttachmentFileUrl(messageId, attachment.id, "preview");

	return (
		<button
			type="button"
			onClick={() => onPreview(attachment)}
			className="group flex w-full items-center gap-3 border border-line bg-surface p-2.5 text-start transition-colors hover:border-line-strong hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
		>
			{visual.thumbnail === "image" && (
				// eslint-disable-next-line @next/next/no-img-element -- attachment served by an authenticated API route
				<img
					src={previewUrl}
					alt=""
					loading="lazy"
					className="h-14 w-14 shrink-0 border border-line bg-canvas-subtle object-cover"
				/>
			)}
			{visual.thumbnail === "video" && (
				<span className="relative h-14 w-14 shrink-0 overflow-hidden bg-black">
					<video
						src={previewUrl}
						muted
						preload="metadata"
						playsInline
						className="h-full w-full object-cover"
					/>
					{/* A scrim over the frame: white in every theme, like the video it sits on. */}
					<span className="absolute inset-0 flex items-center justify-center bg-black/30">
						<Play className="h-5 w-5 fill-[white] text-[white]" />
					</span>
				</span>
			)}
			{visual.thumbnail === null && (
				<span className={`flex h-14 w-14 shrink-0 items-center justify-center border border-line bg-canvas-subtle ${visual.iconClassName}`}>
					<Icon className="h-6 w-6" />
				</span>
			)}
			<span className="min-w-0 flex-1 text-start">
				<span className="block truncate text-sm font-medium text-fg">
					{attachment.filename}
				</span>
				<span className="mt-0.5 block truncate text-xs tabular-nums text-fg-subtle">
					{t(visual.labelKey)} · {formatAttachmentSize(attachment.size)}
				</span>
			</span>
			<ArrowDownToLine className="h-4 w-4 shrink-0 text-fg-subtle transition-colors group-hover:text-accent-text" />
		</button>
	);
}
