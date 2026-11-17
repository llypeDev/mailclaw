"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Loader2, MailPlus } from "@/components/icons";
import { usePathname, useRouter } from "next/navigation";
import { ComposeForm } from "@/components/compose/compose-form";
import { useCompose } from "@/components/compose/compose-context";
import type { ComposeNotice, ComposeNoticeAction } from "@/components/compose/compose-context";
import { useSidebar } from "@/components/sidebar-state";
import { useLanguage } from "@/components/language-provider";
import { authFetch } from "@/lib/auth/client";
import { buttonVariants } from "@/components/ui/button-utils";
import { cn } from "@/lib/utils";
import { COMPOSE_FAB_CLASS } from "./compose-fab-utils";
import { getSendStatusPollDelay } from "./send-notice-utils";

function ComposeNoticeToast({ notice }: { notice: ComposeNotice }) {
	const [now, setNow] = useState(() => Date.now());
	const [pendingAction, setPendingAction] = useState<string | null>(null);
	const countdownEnded = useRef(false);
	const countdown = notice.countdown;
	const parts = notice.parts;
	useEffect(() => {
		if (!countdown) return;
		const timer = window.setInterval(() => setNow(Date.now()), 250);
		return () => window.clearInterval(timer);
	}, [countdown]);
	useEffect(() => {
		if (!countdown || !notice.onCountdownEnd || countdownEnded.current) return;
		if (now < countdown.endAt) return;
		countdownEnded.current = true;
		notice.onCountdownEnd();
	}, [countdown, notice, now]);

	// Delivery is asynchronous after the countdown; watch the persisted status instead of guessing.
	useEffect(() => {
		const poll = notice.poll;
		if (!poll) return;
		let cancelled = false;
		let timer: number | undefined;
		let attempt = 0;
		// The countdown has ended (or there was none) and the queue has just started,
		// so wait before the first check and space the later ones out.
		const schedule = () => {
			if (cancelled) return;
			timer = window.setTimeout(() => void check(), getSendStatusPollDelay(attempt));
			attempt += 1;
		};
		const check = async () => {
			if (cancelled) return;
			try {
				const response = await authFetch(`/api/messages/${poll.messageId}/send-status`);
				if (cancelled) return;
				if (response.ok) {
					const data = await response.json() as { status?: string };
					if (data.status === "sent") { poll.onStatus("sent"); return; }
					if (data.status === "failed") { poll.onStatus("failed"); return; }
					if (data.status === "draft") { poll.onStatus("cancelled"); return; }
				}
			} catch {
				// A transient poll failure keeps the toast waiting until the next attempt.
			}
			schedule();
		};
		schedule();
		return () => {
			cancelled = true;
			if (timer) window.clearTimeout(timer);
		};
	}, [notice.poll]);

	const secondsLeft = countdown ? Math.max(0, Math.ceil((countdown.endAt - now) / 1000)) : null;
	const ticker = parts?.ticker && secondsLeft !== null ? parts.ticker(secondsLeft) : null;

	async function runAction(action: ComposeNoticeAction) {
		if (pendingAction) return;
		const result = action.onClick();
		if (!(result instanceof Promise)) return;
		setPendingAction(action.label);
		try {
			await result;
		} finally {
			setPendingAction(null);
		}
	}

	return (
		<div
			role="status"
			aria-atomic="false"
			className={cn(
				// Orange's toast: raised surface, strong 1px border, the tone as a 3px bar on the start edge.
				// Bottom start, like the other toasts, away from the composer on the bottom end; on phones it spans
				// the width just above the Compose button (COMPOSE_FAB_CLASS: 3rem tall at the bottom inset).
				"fixed bottom-6 start-6 z-[60] flex max-w-[calc(100vw-3rem)] max-md:end-4 max-md:start-4 max-md:bottom-[calc(max(1rem,env(safe-area-inset-bottom))+3.75rem)] max-md:max-w-none",
				"items-center gap-4 border border-line-strong border-s-[length:var(--or-border-accent)] bg-surface-raised px-4 py-3 text-sm font-medium text-fg shadow-lg",
				notice.tone === "error" ? "border-s-danger" : notice.tone === "loading" ? "border-s-line-control" : "border-s-success",
			)}
		>
			{notice.tone === "loading" && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-fg-muted" aria-hidden="true" />}
			<span className="min-w-0 break-words">
				{parts ? (
					<>
						{parts.before}
						{parts.link && (
							// The underline follows the text colour so it stays legible on
							// both the success and the error toast, hover included.
							<Link href={parts.link.href} className="underline decoration-current underline-offset-2 hover:decoration-current">
								{parts.link.label}
							</Link>
						)}
						{parts.after}
						{/* The countdown changes every second; keep it out of the live region. */}
						{ticker !== null && <span aria-live="off">{ticker}</span>}
					</>
				) : notice.message}
			</span>
			{notice.actions.map((action) => (
				<button
					key={action.label}
					type="button"
					onClick={() => void runAction(action)}
					disabled={pendingAction !== null}
					className={cn(buttonVariants({ variant: "outline", size: "sm" }), "shrink-0 disabled:cursor-wait")}
				>
					{action.label}
				</button>
			))}
		</div>
	);
}

/** `showButton` adds the phone Compose button; only the dashboard pages (mail) pass it. */
export function FloatingComposer({ showButton = false }: { showButton?: boolean }) {
	const { open, draftId, initialTo, openComposer, closeComposer, notice } = useCompose();
	const pathname = usePathname();
	const router = useRouter();
	const { t } = useLanguage();
	const { mobileOpen } = useSidebar();
	return (
		<>
			{showButton && !open && !mobileOpen && (
				<button
					type="button"
					onClick={() => openComposer()}
					aria-label={t("navigation.compose")}
					className={COMPOSE_FAB_CLASS}
				>
					<MailPlus size={19} />
					{t("navigation.compose")}
				</button>
			)}
			{notice && <ComposeNoticeToast key={notice.id} notice={notice} />}
			{open && <ComposeForm key={draftId ?? "new"} mode="popup" draftIdToLoad={draftId} initialTo={initialTo} onClose={() => {
				closeComposer();
				if (/^\/drafts\/[^/]+\/?$/.test(pathname)) router.replace("/drafts");
			}} />}
		</>
	);
}
