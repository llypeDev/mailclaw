"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { CalendarDays, HardDrive, Inbox, More01, UsersRound } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { useDismissible } from "@/components/use-dismissible";
import type { AppsMenuProps } from "./mailbox-selector-types";

export function AppsMenu({ user }: AppsMenuProps) {
	const { t } = useLanguage();
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	useDismissible(open, () => setOpen(false), ref);

	const items = [
		{ href: "/inbox", label: t("navigation.inbox"), icon: Inbox, show: true },
		{ href: "/calendar", label: t("account.calendar"), icon: CalendarDays, show: user?.calendarEnabled !== false },
		{ href: "/drive", label: t("account.drive"), icon: HardDrive, show: user?.driveEnabled !== false },
		{ href: "/contacts", label: t("navigation.contacts"), icon: UsersRound, show: true },
	].filter((item) => item.show);

	return (
		<div ref={ref} className="relative">
			<button
				type="button"
				onClick={() => setOpen((value) => !value)}
				className="flex h-10 w-10 items-center justify-center text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
				aria-label={t("account.openApps")}
				aria-expanded={open}
			>
				<More01 size={20} />
			</button>
			{open && (
				<div className="absolute end-0 top-12 z-90 w-56 border border-line bg-surface-raised py-1 shadow-lg">
					{items.map(({ href, label, icon: Icon }) => (
						<Link
							key={href}
							href={href}
							onClick={() => setOpen(false)}
							className="flex items-center gap-3 px-3 py-2 text-sm font-medium text-fg hover:bg-surface-hover"
						>
							<Icon size={18} className="text-fg-muted" />
							{label}
						</Link>
					))}
				</div>
			)}
		</div>
	);
}
