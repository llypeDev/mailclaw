import {
	FileArchive,
	FileCode,
	FileSpreadsheet,
	FileText,
	FileType,
	FileVideoCamera,
	Image,
	Music,
	Presentation,
} from "@/components/icons";
import type { MessageAttachment } from "@/app/(dashboard)/inbox/[messageId]/types";
import type { AttachmentVisual } from "./message-attachment-card-types";
import { getAttachmentPreviewKind } from "./message-attachment-viewer-utils";

export function getAttachmentVisual(
	attachment: Pick<MessageAttachment, "filename" | "type">,
): AttachmentVisual {
	const type = attachment.type.toLowerCase();
	const filename = attachment.filename.toLowerCase();
	const previewKind = getAttachmentPreviewKind(attachment);

	if (previewKind === "image") {
		return {
			icon: Image,
			iconClassName: "text-[var(--or-color-viz-2)]",
			labelKey: "attachment.image",
			thumbnail: "image",
		};
	}
	if (previewKind === "video") {
		return {
			icon: FileVideoCamera,
			iconClassName: "text-[var(--or-color-viz-5)]",
			labelKey: "attachment.video",
			thumbnail: "video",
		};
	}
	if (previewKind === "audio") {
		return {
			icon: Music,
			iconClassName: "text-[var(--or-color-viz-4)]",
			labelKey: "attachment.audio",
			thumbnail: null,
		};
	}
	if (previewKind === "pdf") {
		return {
			icon: FileText,
			iconClassName: "text-[var(--or-color-viz-5)]",
			labelKey: "attachment.pdf",
			thumbnail: null,
		};
	}
	if (
		type.includes("spreadsheet") ||
		type.includes("excel") ||
		type === "text/csv" ||
		/\.(csv|xls|xlsx|ods)$/.test(filename)
	) {
		return {
			icon: FileSpreadsheet,
			iconClassName: "text-[var(--or-color-viz-1)]",
			labelKey: "attachment.spreadsheet",
			thumbnail: null,
		};
	}
	if (
		type.includes("presentation") ||
		type.includes("powerpoint") ||
		/\.(ppt|pptx|odp)$/.test(filename)
	) {
		return {
			icon: Presentation,
			iconClassName: "text-[var(--or-color-viz-3)]",
			labelKey: "attachment.presentation",
			thumbnail: null,
		};
	}
	if (
		type.includes("zip") ||
		type.includes("compressed") ||
		type.includes("archive") ||
		/\.(zip|rar|7z|tar|gz|bz2)$/.test(filename)
	) {
		return {
			icon: FileArchive,
			iconClassName: "text-[var(--or-color-viz-2)]",
			labelKey: "attachment.archive",
			thumbnail: null,
		};
	}
	if (
		type.includes("json") ||
		type.includes("xml") ||
		type.includes("javascript") ||
		type.includes("typescript") ||
		/\.(js|jsx|ts|tsx|json|xml|html|css|md|yml|yaml)$/.test(filename)
	) {
		return {
			icon: FileCode,
			iconClassName: "text-[var(--or-color-viz-1)]",
			labelKey: "attachment.code",
			thumbnail: null,
		};
	}
	if (previewKind === "text" || type.includes("word") || /\.(doc|docx|odt|rtf|txt)$/.test(filename)) {
		return {
			icon: FileType,
			iconClassName: "text-[var(--or-color-viz-2)]",
			labelKey: "attachment.document",
			thumbnail: null,
		};
	}

	return {
		icon: FileText,
		iconClassName: "text-fg-subtle",
		labelKey: "attachment.file",
		thumbnail: null,
	};
}
