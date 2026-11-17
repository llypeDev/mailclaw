"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { useLanguage } from "@/components/language-provider";
import { cn } from "@/lib/utils";
import { SectionNavSheet } from "../section-nav-sheet";
import {
	accountSettingsNavItems,
	getAccountSettingsHref,
	isActiveAccountSettingsPath,
} from "./account-settings-nav-utils";

export function AccountSettingsNav() {
	const { t } = useLanguage();
	const { id } = useParams<{ id: string }>();
	const pathname = usePathname();
	const currentItem = accountSettingsNavItems.find((item) => isActiveAccountSettingsPath(pathname, getAccountSettingsHref(id, item.segment)));
	const currentLabel = t(currentItem?.labelKey ?? "accountSettings.title");

	return (
		<SectionNavSheet title={t("accountSettings.menu")} label={currentLabel} className="w-full shrink-0 px-4 py-4 md:w-48 md:px-0 md:py-0">
			<div className="sticky top-6 space-y-3">
				<h2 className="px-4 font-display text-[length:var(--or-text-2xs)] font-medium uppercase tracking-[var(--or-tracking-meta)] text-fg-subtle">
					{t("accountSettings.title")}
				</h2>
				<nav className="space-y-px border-s border-line">
					{accountSettingsNavItems.map((item) => {
						const href = getAccountSettingsHref(id, item.segment);
						const active = isActiveAccountSettingsPath(pathname, href);
						return (
							<Link
								key={item.segment || "details"}
								href={href}
								aria-current={active ? "page" : undefined}
								className={cn(
									"-ms-px block border-s-2 px-4 py-2.5 text-sm font-medium transition-colors",
									active
										? "border-accent bg-accent-subtle text-accent-text"
										: "border-transparent text-fg-muted hover:bg-surface-hover hover:text-fg",
								)}
							>
								{t(item.labelKey)}
							</Link>
						);
					})}
				</nav>
			</div>
		</SectionNavSheet>
	);
}
