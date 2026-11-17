import { useEffect, useRef, useState } from "react";
import type { DragEvent } from "react";
import { useLanguage } from "@/components/language-provider";
import { authFetch } from "@/lib/auth/client";
import { findAttachmentBlocker } from "./compose-form-utils";
import type { ComposeAttachmentPolicy } from "./attachment-policy-types";
import type { ComposeAttachment, ComposeStoredAttachment } from "./types";

type UploadResult = { attachments?: ComposeStoredAttachment[]; error?: string };

/**
 * Files on the message: new ones picked or dropped in the composer (`attachments`) and the ones the
 * draft already holds server-side (`storedAttachments`, e.g. a forwarded message's files).
 */
export function useComposeAttachments({ busy, onError }: { busy: boolean; onError: (message: string) => void }) {
	const { t } = useLanguage();
	const [attachments, setAttachments] = useState<ComposeAttachment[]>([]);
	const [storedAttachments, setStoredAttachments] = useState<ComposeStoredAttachment[]>([]);
	const [attachmentPolicy, setAttachmentPolicy] = useState<ComposeAttachmentPolicy>({ maxMb: 25, cloudThresholdBytes: 3_000_000 });
	const [draggingFiles, setDraggingFiles] = useState(false);
	// Files already uploaded to the draft, and files the server refused: autosave skips both.
	const uploadedFiles = useRef(new WeakSet<File>());
	const rejectedFiles = useRef(new WeakSet<File>());
	const attachmentInput = useRef<HTMLInputElement | null>(null);
	const fileDragDepth = useRef(0);

	useEffect(() => {
		let active = true;
		void authFetch("/api/attachment-policy", { cache: "no-store" }).then(async (response) => {
			if (response.ok && active) setAttachmentPolicy((await response.json()) as ComposeAttachmentPolicy);
		}).catch(() => {});
		return () => { active = false; };
	}, []);

	function addAttachments(files: FileList | null) {
		if (!files) return;
		const nextFiles = Array.from(files);
		const blocker = findAttachmentBlocker({
			storedSizes: storedAttachments.map((item) => item.size),
			pendingSizes: attachments.map((attachment) => attachment.file.size),
			nextSizes: nextFiles.map((file) => file.size),
			policy: attachmentPolicy,
		});
		if (blocker) {
			onError("vars" in blocker ? t(blocker.key, blocker.vars) : t(blocker.key));
			return;
		}

		setAttachments((current) => [
			...current,
			...nextFiles.map((file) => ({ id: crypto.randomUUID(), file })),
		]);
		if (attachmentInput.current) attachmentInput.current.value = "";
	}

	function removeAttachment(id: string) {
		setAttachments((current) => current.filter((item) => item.id !== id));
	}

	async function removeStoredAttachment(draftId: string | null, attachmentId: string) {
		if (!draftId) return;
		const res = await authFetch(`/api/drafts/${draftId}/attachments/${attachmentId}`, { method: "DELETE" });
		if (!res.ok) {
			onError(t("compose.error.removeAttachment"));
			return;
		}
		setStoredAttachments((current) => current.filter((item) => item.id !== attachmentId));
	}

	/**
	 * Autosave: uploads the files in `current` not yet sent to the draft. A refused batch is
	 * reported once and not retried; uploaded files move to the stored list.
	 */
	async function uploadPendingToDraft(draftId: string, current: ComposeAttachment[]) {
		const pending = current.filter((attachment) => !uploadedFiles.current.has(attachment.file) && !rejectedFiles.current.has(attachment.file));
		if (pending.length === 0) return;
		const form = new FormData();
		for (const attachment of pending) form.append("attachments", attachment.file);
		const uploaded = await authFetch(`/api/drafts/${draftId}/attachments`, { method: "POST", body: form });
		const result = (await uploaded.json()) as UploadResult;
		if (!uploaded.ok) {
			for (const attachment of pending) rejectedFiles.current.add(attachment.file);
			onError(result.error || t("compose.error.draftAttachments"));
			return;
		}
		for (const attachment of pending) uploadedFiles.current.add(attachment.file);
		setStoredAttachments((stored) => [...stored, ...(result.attachments ?? [])]);
		setAttachments((items) => items.filter((attachment) => !uploadedFiles.current.has(attachment.file)));
	}

	/** Before an AI draft is reviewed, every new file goes onto the draft; a failure throws. */
	async function attachAllToDraft(draftId: string) {
		if (attachments.length === 0) return;
		const form = new FormData();
		for (const attachment of attachments) form.append("attachments", attachment.file);
		const uploaded = await authFetch(`/api/drafts/${draftId}/attachments`, { method: "POST", body: form });
		const result = await uploaded.json() as UploadResult;
		if (!uploaded.ok) throw new Error(result.error || t("compose.error.draftAttachments"));
		setStoredAttachments((current) => [...current, ...(result.attachments ?? [])]);
		setAttachments([]);
	}

	/** New files the draft does not hold yet; they travel with the send request. */
	function unsentAttachments() {
		return attachments.filter((attachment) => !uploadedFiles.current.has(attachment.file));
	}

	function clearAttachments() {
		setStoredAttachments([]);
		setAttachments([]);
	}

	function onFileDragEnter(event: DragEvent<HTMLFormElement>) {
		if (!event.dataTransfer.types.includes("Files")) return;
		fileDragDepth.current += 1;
		if (!busy) setDraggingFiles(true);
	}

	function onFileDragOver(event: DragEvent<HTMLFormElement>) {
		if (!event.dataTransfer.types.includes("Files")) return;
		event.preventDefault();
		event.dataTransfer.dropEffect = busy ? "none" : "copy";
	}

	function onFileDragLeave(event: DragEvent<HTMLFormElement>) {
		if (!event.dataTransfer.types.includes("Files")) return;
		fileDragDepth.current = Math.max(0, fileDragDepth.current - 1);
		if (fileDragDepth.current === 0) setDraggingFiles(false);
	}

	function onFileDrop(event: DragEvent<HTMLFormElement>) {
		if (!event.dataTransfer.types.includes("Files")) return;
		event.preventDefault();
		fileDragDepth.current = 0;
		setDraggingFiles(false);
		if (!busy) addAttachments(event.dataTransfer.files);
	}

	return {
		attachments,
		storedAttachments,
		setStoredAttachments,
		attachmentPolicy,
		attachmentInput,
		draggingFiles,
		setDraggingFiles,
		addAttachments,
		removeAttachment,
		removeStoredAttachment,
		uploadPendingToDraft,
		attachAllToDraft,
		unsentAttachments,
		clearAttachments,
		fileDragHandlers: {
			onDragEnterCapture: onFileDragEnter,
			onDragOverCapture: onFileDragOver,
			onDragLeaveCapture: onFileDragLeave,
			onDropCapture: onFileDrop,
		},
	};
}
