"use client";

import Link from "next/link";
import { Mail, X } from "@/components/icons";
import { getEmailDisplayName } from "@/lib/email/address";
import { useLanguage } from "@/components/language-provider";
import type { NewMessagePopupProps } from "./new-message-popup-types";

export function NewMessagePopup({
	notification,
	onDismiss,
}: NewMessagePopupProps) {
	const { t } = useLanguage();
	return (
		<div className="fixed end-5 top-5 z-[100] w-[min(380px,calc(100vw-40px))] border border-line bg-surface-raised p-4 shadow-lg">
			<div className="flex items-start gap-3">
				<div className="flex h-10 w-10 shrink-0 items-center justify-center bg-accent-subtle text-accent-text">
					<Mail className="h-5 w-5" />
				</div>
				<Link
					href={`/inbox/${notification.messageId}`}
					onClick={onDismiss}
					className="min-w-0 flex-1"
				>
					<p className="font-display text-sm font-semibold text-fg">
						{t("notification.newEmail")}
					</p>
					<p className="mt-0.5 truncate text-sm text-fg">
						{notification.subject || t("list.noSubject")}
					</p>
					<p className="mt-1 truncate text-xs text-fg-subtle">
						{/* In-app popup keeps the short name; OS notifications add the real address. */}
						{t("notification.from", { sender: notification.fromName ?? getEmailDisplayName(notification.from) })}
					</p>
				</Link>
				<button
					type="button"
					onClick={onDismiss}
					className="p-1 text-fg-subtle hover:bg-surface-hover hover:text-fg"
				>
					<X className="h-4 w-4" />
					<span className="sr-only">{t("notification.dismiss")}</span>
				</button>
			</div>
		</div>
	);
}
