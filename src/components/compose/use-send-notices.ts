import { useRef } from "react";
import { useLanguage } from "@/components/language-provider";
import { useCompose } from "@/components/compose/compose-context";
import { formatScheduledSendTime } from "@/components/messages/scheduled-send-utils";
import { authFetch } from "@/lib/auth/client";
import { clearMessageDetailCache } from "@/lib/messages/detail-cache";
import { DELIVERY_WAIT_MS, SCHEDULED_NOTICE_MS, SENT_NOTICE_MS, resolveSendNotice, splitSendTemplate } from "./send-notice-utils";
import type { SendNoticeParts, SendResult } from "./send-notice-utils";

/**
 * The toasts that follow a send: the undo countdown (Undo / Send now), the delivery watch,
 * the scheduled-send confirmation (Cancel) and the final "sent" link. They outlive the composer,
 * so they only use the compose context, never the form's state.
 */
export function useSendNotices() {
	const { t } = useLanguage();
	const { showNotice, openDraftComposer, isCurrentNotice } = useCompose();
	const noticeActionInFlight = useRef(false);

	/**
	 * Splits a translated template around {subject} so the subject can link to the
	 * message, and around {seconds} so only the ticking suffix changes. Passing the
	 * placeholders back as values leaves them intact for the split.
	 *
	 * A message that is still queued is listed under Scheduled; only a delivered one
	 * lives in Sent, so the link follows the message's state.
	 */
	function buildSubjectNotice(
		key: "compose.sendingIn" | "compose.sendingSubject" | "compose.sentSubject",
		subjectLabel: string,
		messageId: string,
		countdown: boolean,
	): { message: string; parts: SendNoticeParts } {
		const template = t(key, { subject: "{subject}", seconds: "{seconds}" });
		const href = key === "compose.sentSubject" ? `/sent/${messageId}` : `/scheduled/${messageId}`;
		const parts: SendNoticeParts = {
			...splitSendTemplate(template, countdown),
			link: { label: subjectLabel, href },
		};
		return { message: t(key, { subject: subjectLabel, seconds: 1 }), parts };
	}

	/** Shows the message while the queue delivers it and watches for the final status. */
	function showSendingNotice(messageId: string, subjectLabel: string): number {
		const content = buildSubjectNotice("compose.sendingSubject", subjectLabel, messageId, false);
		let noticeId = 0;
		noticeId = showNotice(content.message, {
			parts: content.parts,
			durationMs: DELIVERY_WAIT_MS,
			poll: {
				messageId,
				onStatus: (status) => {
					if (status === "sent") {
						// Delivered: refresh the lists even if a newer toast has taken over.
						showSentNotice(messageId, subjectLabel, noticeId);
						return;
					}
					if (!isCurrentNotice(noticeId)) return;
					if (status === "failed") showNotice(t("compose.error.sendFailed"), { tone: "error" });
					else showNotice(null);
				},
			},
		}) ?? 0;
		return noticeId;
	}

	function showSentNotice(messageId: string, subjectLabel: string, sourceNoticeId: number) {
		// The message is delivered, so the lists and the cached detail are stale
		// whichever toast is on screen; refresh them before the notice check.
		clearMessageDetailCache();
		window.dispatchEvent(new Event("mailclaw:messages-changed"));
		if (!isCurrentNotice(sourceNoticeId)) return;
		const content = buildSubjectNotice("compose.sentSubject", subjectLabel, messageId, false);
		showNotice(content.message, { parts: content.parts, durationMs: SENT_NOTICE_MS });
	}

	async function sendNow(messageId: string, subjectLabel: string, sourceNoticeId: number) {
		if (noticeActionInFlight.current) return;
		noticeActionInFlight.current = true;
		try {
			const response = await authFetch(`/api/messages/${messageId}/send-now`, { method: "POST" });
			if (response.ok) {
				// The message is on its way: refresh the lists even if a newer toast has taken over.
				showSentNotice(messageId, subjectLabel, sourceNoticeId);
				return;
			}
			if (!isCurrentNotice(sourceNoticeId)) return;
			if (response.status === 409) {
				// The queued delivery claimed the message first; watch it instead of failing.
				showSendingNotice(messageId, subjectLabel);
				return;
			}
			if (response.status >= 500) {
				// The request may have failed before claiming the job; the scheduled send can
				// still deliver later, so let the status poll decide instead of reporting failure.
				showSendingNotice(messageId, subjectLabel);
				return;
			}
			const result = await response.json().catch(() => ({})) as { error?: string };
			if (!isCurrentNotice(sourceNoticeId)) return;
			showNotice(result.error ?? t("compose.error.sendFailed"), { tone: "error" });
		} catch {
			// A dropped response is ambiguous: the message may still be on its way.
			if (isCurrentNotice(sourceNoticeId)) showSendingNotice(messageId, subjectLabel);
		} finally {
			noticeActionInFlight.current = false;
		}
	}

	async function cancelSend(messageId: string, source: "undo" | "scheduled", sourceNoticeId: number) {
		if (noticeActionInFlight.current) return;
		noticeActionInFlight.current = true;
		try {
			const res = await authFetch(`/api/messages/${messageId}/cancel-schedule`, { method: "POST" });
			if (!res.ok) {
				if (!isCurrentNotice(sourceNoticeId)) return;
				// A 409 on the undo toast means the queue claimed it; a scheduled send can also fail for other reasons.
				showNotice(source === "undo" && res.status === 409 ? t("compose.cancelTooLate") : t("schedule.cancelFailed"), {
					tone: "error",
				});
				return;
			}
			// The message is back in Drafts, so the lists and the cached detail are
			// stale whichever toast is on screen; refresh them before the notice check.
			clearMessageDetailCache();
			window.dispatchEvent(new Event("mailclaw:messages-changed"));
			if (!isCurrentNotice(sourceNoticeId)) return;
			showNotice(t("compose.sendCancelled"));
			openDraftComposer(messageId);
		} catch {
			if (isCurrentNotice(sourceNoticeId)) showNotice(t("schedule.cancelFailed"), { tone: "error" });
		} finally {
			noticeActionInFlight.current = false;
		}
	}

	/** Shows the toast that matches what `/api/send` answered. */
	function showSendResult(data: SendResult, subjectLabel: string) {
		const notice = resolveSendNotice(data);
		if (notice.kind === "undo") {
			const content = buildSubjectNotice("compose.sendingIn", subjectLabel, notice.messageId, true);
			let undoNoticeId = 0;
			// The send is queued for the undo window; Undo returns it to Drafts and Send now skips the wait.
			undoNoticeId = showNotice(content.message, {
				parts: content.parts,
				durationMs: notice.durationMs,
				countdown: { endAt: notice.endAt },
				// Delivery starts after the window; keep watching until the queue reports a result.
				onCountdownEnd: () => {
					if (!isCurrentNotice(undoNoticeId) || noticeActionInFlight.current) return;
					showSendingNotice(notice.messageId, subjectLabel);
				},
				actions: [
					{ label: t("compose.undoSend"), onClick: () => cancelSend(notice.messageId, "undo", undoNoticeId) },
					{ label: t("compose.sendNow"), onClick: () => sendNow(notice.messageId, subjectLabel, undoNoticeId) },
				],
			}) ?? 0;
		} else if (notice.kind === "sending") {
			showSendingNotice(notice.messageId, subjectLabel);
		} else if (notice.kind === "scheduled") {
			const message = notice.scheduledAt
				? t("schedule.sendScheduledFor", { when: formatScheduledSendTime(notice.scheduledAt, t) })
				: t("compose.scheduled");
			let scheduledNoticeId = 0;
			scheduledNoticeId = showNotice(message, {
				durationMs: SCHEDULED_NOTICE_MS,
				actions: [{ label: t("schedule.cancelSend"), onClick: () => cancelSend(notice.messageId, "scheduled", scheduledNoticeId) }],
			}) ?? 0;
		} else {
			showNotice(t("compose.sent"));
		}
	}

	return { showSendResult };
}
