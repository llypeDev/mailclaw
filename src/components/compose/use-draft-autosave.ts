import { useEffect, useRef, useState } from "react";
import { authFetch } from "@/lib/auth/client";
import { DRAFT_AUTOSAVE_DELAY_MS, buildDraftPayload, hasDraftContent } from "./compose-form-utils";
import type { ComposeDraftFields } from "./compose-form-types";
import type { ComposeAttachment } from "./types";

/**
 * Saves the message as a draft 900 ms after the last edit, one save at a time.
 *
 * `draftGeneration` changes when the message is sent or discarded, so a save still in flight
 * for the old message neither adopts its draft id nor leaves a new draft behind.
 * A failed save is reported through `onSaveFailed` only on the first failure of a run; the
 * next edit schedules another save, and a success clears `saveFailed`.
 */
export function useDraftAutosave({
	fields,
	attachments,
	signature,
	loadingDraft,
	agentRevision,
	uploadPendingAttachments,
	onSaveFailed,
}: {
	fields: ComposeDraftFields;
	attachments: ComposeAttachment[];
	signature: string | null | undefined;
	loadingDraft: boolean;
	agentRevision: number | null;
	uploadPendingAttachments: (draftId: string, current: ComposeAttachment[]) => Promise<void>;
	onSaveFailed: () => void;
}) {
	const [draftId, setDraftId] = useState<string | null>(null);
	const [saveFailed, setSaveFailed] = useState(false);
	const saveFailedRef = useRef(false);
	const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const pendingSave = useRef<(() => Promise<void>) | null>(null);
	const draftGeneration = useRef(0);
	const draftIdRef = useRef<string | null>(null);
	const agentRevisionRef = useRef(agentRevision);
	useEffect(() => {
		agentRevisionRef.current = agentRevision;
	}, [agentRevision]);
	// A pending human send review owns this snapshot. Autosaving after creating
	// an approval increments its revision and makes confirmation impossible.
	const reviewInProgressRef = useRef(false);
	const saveQueue = useRef<Promise<void>>(Promise.resolve());

	function reportSaveFailure() {
		if (!saveFailedRef.current) onSaveFailed();
		saveFailedRef.current = true;
		setSaveFailed(true);
	}

	function clearSaveFailure() {
		saveFailedRef.current = false;
		setSaveFailed(false);
	}

	// Leaving the composer flushes a save that was still waiting for its timer.
	useEffect(() => () => {
		void pendingSave.current?.();
	}, []);

	const { mailboxId, from, to, cc, bcc, subject, html, quotedHtml, threading } = fields;
	useEffect(() => {
		pendingSave.current = null;
		const snapshot: ComposeDraftFields = { mailboxId, from, to, cc, bcc, subject, html, quotedHtml, threading };
		if (!from || !hasDraftContent(snapshot, attachments.length, signature) || loadingDraft || reviewInProgressRef.current) return;
		if (saveTimer.current) clearTimeout(saveTimer.current);

		const generation = draftGeneration.current;
		const save = () => {
			const run = saveQueue.current.then(async () => {
				if (generation !== draftGeneration.current || reviewInProgressRef.current) return;
				const payload = buildDraftPayload(snapshot);
				const existingId = draftIdRef.current;
				let data: { draft?: { id: string } } | null = null;
				try {
					const res = await authFetch(existingId ? `/api/drafts/${existingId}` : "/api/drafts", {
						method: existingId ? "PATCH" : "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify(payload),
					});
					const body = (await res.json().catch(() => null)) as { draft?: { id: string } } | null;
					if (res.ok && body?.draft?.id) data = body;
				} catch {
					// A dropped request is a failed save like any other.
				}
				if (!data?.draft?.id) {
					// The next edit schedules another save, which is the retry.
					if (generation === draftGeneration.current) reportSaveFailure();
					return;
				}
				if (generation !== draftGeneration.current) {
					if (!existingId) void authFetch(`/api/drafts/${data.draft.id}`, { method: "DELETE" });
					return;
				}
				clearSaveFailure();
				draftIdRef.current = data.draft.id;
				setDraftId(data.draft.id);
				if (agentRevisionRef.current !== null) return;
				await uploadPendingAttachments(data.draft.id, attachments);
			}).catch(() => {});
			saveQueue.current = run;
			return run;
		};
		pendingSave.current = save;
		saveTimer.current = setTimeout(() => {
			pendingSave.current = null;
			void save();
		}, DRAFT_AUTOSAVE_DELAY_MS);

		return () => {
			if (saveTimer.current) clearTimeout(saveTimer.current);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the draft content only; `uploadPendingAttachments` and `reportSaveFailure` are new functions every render, and listing them would restart the 900 ms timer on every render
	}, [attachments, bcc, cc, from, html, loadingDraft, quotedHtml, mailboxId, signature, subject, threading, to]);

	/** Drops a save waiting for its timer, e.g. right before sending. */
	function cancelScheduledSave() {
		if (saveTimer.current) clearTimeout(saveTimer.current);
		pendingSave.current = null;
	}

	/** Resolves once the save in flight, if any, has finished. */
	function waitForSaves() {
		return saveQueue.current;
	}

	/** The message was sent or discarded: saves already queued for it must not touch a draft. */
	function retireDraft() {
		draftGeneration.current += 1;
	}

	/** Points autosave at a draft (a loaded one) or at none (after sending or discarding). */
	function adoptDraft(id: string | null) {
		draftIdRef.current = id;
		setDraftId(id);
		if (id === null) clearSaveFailure();
	}

	return { draftId, draftIdRef, reviewInProgressRef, saveFailed, cancelScheduledSave, waitForSaves, retireDraft, adoptDraft };
}
