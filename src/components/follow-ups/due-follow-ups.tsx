"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { BellRing, Check } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { Tooltip } from "@/components/ui/tooltip";
import type { DueFollowUp } from "@/lib/follow-ups/types";
import { formatUserDate } from "@/lib/time/utils";
import { FollowUpMenu } from "./follow-up-menu";
import { fetchDueFollowUps, FOLLOW_UPS_CHANGED_EVENT, updateDueFollowUp } from "./follow-up-client-utils";

const DATE_FORMAT: Intl.DateTimeFormatOptions = { month: "short", day: "2-digit" };
const ACTION_CLASS = "p-1.5 text-fg-subtle hover:bg-surface-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

/** Sent messages still waiting for a reply after their reminder came due, pinned above the inbox. */
export function DueFollowUps({ mailboxId }: { mailboxId?: string | null }) {
	const { t } = useLanguage();
	const [items, setItems] = useState<DueFollowUp[]>([]);
	const [failed, setFailed] = useState(false);

	const load = useCallback(() => {
		void fetchDueFollowUps(mailboxId).then(setItems).catch(() => undefined);
	}, [mailboxId]);

	useEffect(() => {
		let timer: number | null = null;
		function scheduleLoad() {
			if (document.visibilityState !== "visible") return;
			if (timer) window.clearTimeout(timer);
			timer = window.setTimeout(() => {
				timer = null;
				load();
			}, 150);
		}
		function onMessagesChanged(event: Event) {
			if ((event as CustomEvent<{ kind?: string }>).detail?.kind === "read") return;
			scheduleLoad();
		}
		load();
		window.addEventListener(FOLLOW_UPS_CHANGED_EVENT, load);
		window.addEventListener("mailclaw:messages-changed", onMessagesChanged);
		return () => {
			window.removeEventListener(FOLLOW_UPS_CHANGED_EVENT, load);
			window.removeEventListener("mailclaw:messages-changed", onMessagesChanged);
			if (timer) window.clearTimeout(timer);
		};
	}, [load]);

	function update(id: string, change: Parameters<typeof updateDueFollowUp>[1]) {
		setFailed(false);
		setItems((current) => current.filter((item) => item.id !== id));
		void updateDueFollowUp(id, change).catch(() => {
			setFailed(true);
			load();
		});
	}

	if (items.length === 0) return null;

	return (
		<section aria-label={t("followUp.sectionLabel")} className="border-b border-line border-s-2 border-s-warning bg-warning-subtle">
			<h2 className="flex items-center gap-1.5 px-6 pb-1 pt-2.5 font-display text-xs font-medium uppercase tracking-wider text-warning-text">
				<BellRing className="h-3.5 w-3.5" aria-hidden />
				{t("followUp.sectionTitle", { count: items.length })}
			</h2>
			<ul className="divide-y divide-line-subtle">
				{items.map((item) => (
					<li key={item.id} className="flex items-center gap-2 px-6 py-1.5 text-sm">
						<Link href={`/sent/${item.messageId}`} className="flex min-w-0 flex-1 items-baseline gap-3 hover:underline">
							<span className="w-40 shrink-0 truncate text-fg-muted max-md:w-28">{t("followUp.to", { to: item.toAddr })}</span>
							<span className="min-w-0 flex-1 truncate font-medium text-fg">{item.subject || t("list.noSubject")}</span>
							<time dateTime={item.sentAt} className="shrink-0 text-xs tabular-nums text-fg-subtle">{formatUserDate(item.sentAt, DATE_FORMAT)}</time>
						</Link>
						<FollowUpMenu
							trigger={
								<button type="button" aria-label={t("followUp.remindAgain")} className={ACTION_CLASS}>
									<BellRing className="h-4 w-4" />
								</button>
							}
							onPick={(days) => update(item.id, { action: "snooze", days })}
						/>
						<Tooltip label={t("followUp.done")}>
							<button type="button" aria-label={t("followUp.done")} onClick={() => update(item.id, { action: "dismiss" })} className={ACTION_CLASS}>
								<Check className="h-4 w-4" />
							</button>
						</Tooltip>
					</li>
				))}
			</ul>
			{failed && <p role="alert" className="px-6 pb-2 text-xs text-danger-text">{t("followUp.failed")}</p>}
		</section>
	);
}
