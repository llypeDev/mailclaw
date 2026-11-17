"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLanguage } from "@/components/language-provider";
import { useSelectedMailbox } from "@/components/mailbox-provider";
import { authFetch } from "@/lib/auth/client";
import { getEmailAddress } from "@/lib/email/address";
import { cn } from "@/lib/utils";
import { SendReview } from "@/components/agent/send-review";
import type { ReviewSnapshot } from "@/components/agent/send-review-types";
import { useIsMobile } from "@/components/sidebar-mobile-utils";
// Network and editor modules are imported by alias here and in the split-out pieces: the composer
// tests (tests/compose-*.test.mjs) replace them by that path.
import { buildSendFormData, fetchDraft } from "@/components/compose/utils";
import { RichTextEditor } from "@/components/compose/rich-text-editor";
import { useSheetViewport } from "@/components/compose/use-sheet-viewport";
import { useTrackOpens } from "./use-track-opens";
import type { SendResult } from "./send-notice-utils";
import {
	applyMailboxSignatureHtml,
	hasMeaningfulHtml,
	htmlToPlainText,
	joinQuotedHtml,
	splitQuotedHtml,
	textToHtml,
} from "./rich-text-utils";
import { recipientsToHeader } from "./recipient-utils";
import { buildDraftPayload, composeFrameClass, composeTitleKey, findSendBlocker, isForwardSubject } from "./compose-form-utils";
import { ComposeAttachmentList } from "./compose-attachment-list";
import { ComposeFields } from "./compose-fields";
import { ComposeTitleBar } from "./compose-title-bar";
import { ComposeSendControls, ComposeToolbarActions } from "./compose-toolbar";
import { useComposeAttachments } from "./use-compose-attachments";
import { useComposeRecipients } from "./use-compose-recipients";
import { useComposeSender } from "./use-compose-sender";
import { useDraftAutosave } from "./use-draft-autosave";
import { useSendNotices } from "./use-send-notices";
import { useSheetDismiss } from "./use-sheet-dismiss";
import type { ComposeFormProps, ComposeToast } from "./compose-form-types";
import type { ComposeThreading } from "./types";

export function ComposeForm({
	mode = "page",
	draftIdToLoad,
	initialTo,
	onClose,
}: ComposeFormProps) {
	const { t } = useLanguage();
	const router = useRouter();
	const { selectedMailbox, setSelectedMailbox, mailboxes } = useSelectedMailbox();
	const [agentRevision, setAgentRevision] = useState<number | null>(null);
	const [agentReview, setAgentReview] = useState<{ approvalId: string; snapshot: ReviewSnapshot } | null>(null);
	const recipients = useComposeRecipients(initialTo, Boolean(draftIdToLoad));
	const { to, cc, bcc } = recipients;
	const [threading, setThreading] = useState<ComposeThreading | null>(null);
	const [subject, setSubject] = useState("");
	// The body is HTML; quoted/forwarded content is kept aside and folded.
	const [html, setHtml] = useState("");
	const [quotedHtml, setQuotedHtml] = useState<string | null>(null);
	const [modalMode, setModalMode] = useState(false);
	const [minimized, setMinimized] = useState(false);
	const [toast, setToast] = useState<ComposeToast>(null);
	const [loading, setLoading] = useState(false);
	const [loadingDraft, setLoadingDraft] = useState(false);
	const [deletingDraft, setDeletingDraft] = useState(false);
	const [scheduledAt, setScheduledAt] = useState<Date | null>(null);
	const [trackOpens, setTrackOpens] = useTrackOpens();
	const [followUpDays, setFollowUpDays] = useState<number | null>(null);
	const [loadedDraftMailboxId, setLoadedDraftMailboxId] = useState<string | null>(null);
	const [loadedDraftFrom, setLoadedDraftFrom] = useState<string | null>(null);
	const formRef = useRef<HTMLFormElement>(null);
	useSheetViewport(formRef, mode === "popup");
	const isPhone = useIsMobile();
	const { dismiss, closing, dragY, sheetDrag } = useSheetDismiss(onClose, mode === "popup" && isPhone);
	const previousSignature = useRef("");
	const showError = (message: string) => setToast({ type: "error", message });

	const { selectedFrom, senderOptions, fromAddr, selectSender } = useComposeSender({ selectedMailbox, setSelectedMailbox, mailboxes, loadedDraftFrom });
	const files = useComposeAttachments({ busy: loading || loadingDraft, onError: showError });
	const { attachments, storedAttachments } = files;
	const autosave = useDraftAutosave({
		fields: { mailboxId: selectedMailbox?.id, from: fromAddr, to, cc, bcc, subject, html, quotedHtml, threading },
		attachments,
		signature: selectedMailbox?.signature,
		loadingDraft,
		agentRevision,
		uploadPendingAttachments: files.uploadPendingToDraft,
		// Reported once per run of failures; the title bar keeps saying so until a save succeeds.
		onSaveFailed: () => showError(t("compose.error.autosave")),
	});
	const { draftId, draftIdRef, reviewInProgressRef } = autosave;
	const { showSendResult } = useSendNotices();

	useEffect(() => {
		if (!toast) return;
		const timer = setTimeout(() => setToast(null), 3200);
		return () => clearTimeout(timer);
	}, [toast]);

	useEffect(() => {
		if (!draftIdToLoad) return;

		let cancelled = false;
		// eslint-disable-next-line react-hooks/set-state-in-effect -- flags the fetch below as in flight; the signature and autosave effects rely on it flipping after the first commit.
		setLoadingDraft(true);
		fetchDraft(draftIdToLoad)
			.then((draft) => {
				if (cancelled) return;

				autosave.adoptDraft(draft.id);
				setAgentRevision(draft.agent?.revision ?? null);
				setScheduledAt(draft.agent?.scheduledAt ? new Date(draft.agent.scheduledAt) : null);
				recipients.loadFromHeaders({ to: draft.toAddr, cc: draft.ccAddr, bcc: draft.bccAddr });
				setThreading(
					draft.inReplyTo || draft.threadId
						? {
							inReplyTo: draft.inReplyTo ?? null,
							references: draft.references ?? null,
							threadId: draft.threadId ?? null,
						}
						: null,
				);
				setSubject(draft.subject ?? "");
				const stored = splitQuotedHtml(draft.htmlBody || textToHtml(draft.textBody));
				setHtml(stored.body);
				setQuotedHtml(stored.quoted);
				files.setStoredAttachments(draft.attachments?.filter((item) => item.disposition === "attachment") ?? []);
				setLoadedDraftMailboxId(draft.mailboxId);
				setLoadedDraftFrom(getEmailAddress(draft.fromAddr).toLowerCase());
			})
			.catch((err) => {
				if (cancelled) return;
				const message = err instanceof Error ? err.message : t("compose.error.loadDraft");
				setToast({ type: "error", message });
			})
			.finally(() => {
				if (!cancelled) setLoadingDraft(false);
			});

		return () => {
			cancelled = true;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps -- load once per draft id; `autosave`, `files` and `recipients` are new objects every render and `t` only words the error, so listing them would refetch the draft over the user's edits
	}, [draftIdToLoad]);

	useEffect(() => {
		if (!loadedDraftMailboxId) return;
		if (selectedMailbox?.id === loadedDraftMailboxId) return;

		const draftMailbox = mailboxes.find((mailbox) => mailbox.id === loadedDraftMailboxId);
		if (draftMailbox) setSelectedMailbox(draftMailbox);
	}, [loadedDraftMailboxId, mailboxes, selectedMailbox?.id, setSelectedMailbox]);

	useEffect(() => {
		if (loadingDraft) return;
		const nextSignature = selectedMailbox?.signature ?? "";
		setHtml((current) => applyMailboxSignatureHtml(current, previousSignature.current, nextSignature));
		previousSignature.current = nextSignature;
	}, [loadingDraft, selectedMailbox?.id, selectedMailbox?.signature]);

	useEffect(() => {
		if (!draftIdToLoad || loadingDraft) return;
		formRef.current?.querySelector<HTMLElement>("[contenteditable='true']")?.focus();
	}, [draftIdToLoad, loadingDraft]);

	/** Empties the composer after the message was sent or its draft deleted. */
	function resetComposer() {
		autosave.adoptDraft(null);
		recipients.clear();
		setThreading(null);
		setSubject("");
		setHtml(applyMailboxSignatureHtml("", "", selectedMailbox?.signature));
		setQuotedHtml(null);
		files.clearAttachments();
		setScheduledAt(null);
	}

	async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const blocker = findSendBlocker({ to, cc, bcc, html, quotedHtml, scheduledAt });
		if (blocker) {
			showError("vars" in blocker ? t(blocker.key, blocker.vars) : t(blocker.key));
			return;
		}
		// Freeze autosave for an AI draft before waiting for any queued save.
		// Otherwise a debounced PATCH can invalidate the approval snapshot.
		if (draftId && agentRevision !== null) reviewInProgressRef.current = true;
		autosave.cancelScheduledSave();
		setLoading(true);
		await autosave.waitForSaves();
		const currentDraftId = draftIdRef.current;
		const unsentAttachments = files.unsentAttachments();
		const fullHtml = joinQuotedHtml(html, quotedHtml);
		if (draftId && agentRevision !== null) {
			try {
				autosave.cancelScheduledSave();
				await files.attachAllToDraft(draftId);
				const payload = { ...buildDraftPayload({ mailboxId: selectedMailbox?.id, from: fromAddr, to, cc, bcc, subject, html, quotedHtml, threading }), scheduledAt: scheduledAt?.toISOString() ?? null };
				const updated = await authFetch(`/api/drafts/${draftId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
				if (!updated.ok) throw new Error(t("compose.error.saveForReview"));
				const current = await fetchDraft(draftId);
				if (!current.agent) throw new Error(t("compose.error.aiMetadata"));
				setAgentRevision(current.agent.revision);
				const response = await authFetch("/api/agent/approvals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ draftId, expectedRevision: current.agent.revision }) });
				const result = await response.json() as { approvalId?: string; snapshot?: ReviewSnapshot; error?: string };
				if (!response.ok || !result.approvalId || !result.snapshot) throw new Error(result.error || t("compose.error.createReview"));
				setAgentReview({ approvalId: result.approvalId, snapshot: result.snapshot });
			} catch (cause) {
				reviewInProgressRef.current = false;
				showError(cause instanceof Error ? cause.message : t("compose.error.reviewDraft"));
			}
			finally { setLoading(false); }
			return;
		}
		let res: Response;
		let data: SendResult & { error?: string };
		try {
			res = await authFetch("/api/send", {
				method: "POST",
				body: buildSendFormData({
					attachments: unsentAttachments,
					from: fromAddr,
					to: recipientsToHeader(to),
					cc: recipientsToHeader(cc),
					bcc: recipientsToHeader(bcc),
					subject,
					text: htmlToPlainText(fullHtml),
					html: fullHtml,
					mailboxId: selectedMailbox?.id,
					threading: threading ?? undefined,
					draftId,
					scheduledAt,
					undoSend: true,
					trackOpens,
					followUpDays,
				}),
			});
			data = (await res.json()) as SendResult & { error?: string };
		} catch {
			setLoading(false);
			showError(t("compose.error.sendFailed"));
			return;
		}
		setLoading(false);

		if (!res.ok) {
			showError(data.error ?? t("compose.error.sendFailed"));
			return;
		}

		// With a draft, refresh once it is gone so the lists reload a single time.
		const refreshLists = () => window.dispatchEvent(new Event("mailclaw:messages-changed"));
		if (currentDraftId) void authFetch(`/api/drafts/${currentDraftId}`, { method: "DELETE" }).finally(refreshLists);
		autosave.retireDraft();
		resetComposer();
		showSendResult(data, subject.trim() || t("list.noSubject"));
		if (!currentDraftId) refreshLists();

		if (onClose) {
			dismiss();
			return;
		}
		router.push("/sent");
	}

	async function deleteDraftAndClose() {
		autosave.cancelScheduledSave();
		autosave.retireDraft();
		setDeletingDraft(true);
		await autosave.waitForSaves();

		if (draftIdRef.current) {
			let deleted = false;
			try {
				const res = await authFetch(`/api/drafts/${draftIdRef.current}`, { method: "DELETE" });
				deleted = res.ok || res.status === 404;
			} catch {
				deleted = false;
			}
			if (!deleted) {
				setDeletingDraft(false);
				showError(t("compose.error.deleteDraft"));
				return;
			}
		}

		resetComposer();
		window.dispatchEvent(new Event("mailclaw:messages-changed"));

		if (onClose) {
			dismiss();
			return;
		}
		setDeletingDraft(false);
		router.push("/inbox");
	}

	const isReply = Boolean(threading?.inReplyTo);
	const busy = loading || loadingDraft;
	const sendDisabled = busy || !fromAddr;

	return (
		<>
			{agentReview && <SendReview approvalId={agentReview.approvalId} snapshot={agentReview.snapshot} onClose={() => { reviewInProgressRef.current = false; setAgentReview(null); }} onSent={() => { reviewInProgressRef.current = false; setAgentReview(null); if (onClose) dismiss(); else router.push("/sent"); }} />}
			{mode === "popup" && modalMode && !minimized && <div className="fixed inset-0 z-40 bg-overlay" aria-hidden="true" />}
			{toast && (
				<div
					role={toast.type === "error" ? "alert" : "status"}
					className={cn(
						"fixed end-6 top-6 z-[60] max-w-[calc(100vw-3rem)] border border-line-strong border-s-[length:var(--or-border-accent)] bg-surface-raised px-4 py-3 text-sm font-medium text-fg shadow-lg",
						toast.type === "success" ? "border-s-success" : "border-s-danger",
					)}
				>
					{toast.message}
				</div>
			)}
			<form onSubmit={onSubmit} className={cn(composeFrameClass(mode, minimized, modalMode), closing && "compose-sheet-closing")} style={dragY ? { transform: `translateY(${dragY}px)`, transition: "none" } : undefined} ref={formRef} role={modalMode && !minimized ? "dialog" : mode === "popup" ? "region" : undefined} aria-modal={modalMode && !minimized || undefined} aria-label={mode === "popup" ? t("compose.dialogLabel") : undefined} onKeyDown={(event) => { if (modalMode && !minimized && event.key === "Escape") { event.preventDefault(); setModalMode(false); } }} {...(minimized ? {} : files.fileDragHandlers)}>
				{files.draggingFiles && !minimized && (
					<div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center border-2 border-dashed border-accent-border bg-accent-subtle/90 font-display text-sm font-medium text-accent-text" aria-hidden="true">
						{t("compose.dropFiles")}
					</div>
				)}
				<ComposeTitleBar
					mode={mode}
					titleKey={composeTitleKey({ loadingDraft, isReply, subject, saved: Boolean(draftId) && !autosave.saveFailed })}
					isReply={isReply}
					isForward={isForwardSubject(subject)}
					saveFailed={autosave.saveFailed}
					minimized={minimized}
					modalMode={modalMode}
					onToggleMinimized={() => { setMinimized((current) => !current); files.setDraggingFiles(false); }}
					onToggleModal={() => { if (minimized) setMinimized(false); setModalMode((current) => !current); }}
					onClose={dismiss}
					dragHandlers={sheetDrag}
				/>
				<div className={cn("flex min-h-0 flex-1 flex-col", minimized && "hidden")}>
				<ComposeFields
					mode={mode}
					senderOptions={senderOptions}
					senderValue={selectedMailbox && selectedFrom ? `${selectedMailbox.id}|${selectedFrom}` : ""}
					onSelectSender={selectSender}
					recipients={recipients}
					mailboxId={selectedMailbox?.id}
					subject={subject}
					onSubjectChange={setSubject}
					disabled={loadingDraft}
					autoFocusTo={!draftIdToLoad}
				/>
				<RichTextEditor
					id={`${mode}-text`}
					value={html}
					onChange={setHtml}
					quotedHtml={quotedHtml}
					disabled={loadingDraft}
					placeholder={t("compose.bodyPlaceholder")}
					footerContent={(attachments.length > 0 || storedAttachments.length > 0) && (
						<ComposeAttachmentList
							attachments={attachments}
							storedAttachments={storedAttachments}
							cloudThresholdBytes={files.attachmentPolicy.cloudThresholdBytes}
							onRemove={files.removeAttachment}
							onRemoveStored={(id) => void files.removeStoredAttachment(draftIdRef.current, id)}
						/>
					)}
					toolbarStart={
						<ComposeSendControls
							sendLabel={loading ? t("compose.preparing") : scheduledAt ? t("compose.schedule") : agentRevision !== null ? t("compose.reviewSend") : t("compose.send")}
							disabled={sendDisabled}
							onCancel={dismiss}
							scheduledAt={scheduledAt}
							onScheduleChange={setScheduledAt}
							mailboxId={selectedMailbox?.id}
							from={fromAddr}
							onApplyTemplate={({ title, html: templateHtml }) => {
								setSubject((current) => current.trim() ? current : title);
								setHtml((current) => (hasMeaningfulHtml(current) ? `${current}${templateHtml}` : templateHtml));
							}}
						/>
					}
					toolbarEnd={
						<ComposeToolbarActions
							attachmentInput={files.attachmentInput}
							onAddFiles={files.addAttachments}
							maxAttachmentMb={files.attachmentPolicy.maxMb}
							disabled={busy}
							trackOpens={trackOpens}
							onTrackOpensChange={setTrackOpens}
							followUpDays={followUpDays}
							onFollowUpChange={setFollowUpDays}
							deleteDisabled={busy || deletingDraft}
							onDeleteDraft={() => void deleteDraftAndClose()}
						/>
					}
				/>
				</div>
			</form>
		</>
	);
}
