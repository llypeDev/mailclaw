"use client";

import { Eyebrow } from "@orangesys/ui";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLanguage } from "@/components/language-provider";
import { useCurrentUser } from "@/hooks/use-current-user";
import { cn } from "@/lib/utils";
import { SectionNavSheet } from "../section-nav-sheet";
import { isActiveSettingsPath, settingsNavSections } from "./settings-nav-utils";

export function SettingsNav() {
	const { t } = useLanguage();
	const pathname = usePathname();
	const user = useCurrentUser();
	const canManageMailboxes = user?.canManageMailboxes === true;
	const sections = settingsNavSections.map((section) => ({
		...section,
		items: section.items.filter((item) => !item.requiresMailboxAccess || canManageMailboxes),
	}));
	const currentItem = sections.flatMap((section) => section.items).find((item) => isActiveSettingsPath(pathname, item.href));
	const currentLabel = t(currentItem?.labelKey ?? "settings.nav.settings");

	return (
		<SectionNavSheet title={t("settings.nav.menu")} label={currentLabel} className="w-full px-4 py-4 md:min-h-full md:w-64 md:border-s md:border-line md:py-10">
			<div className="sticky top-6 space-y-7">
				{sections.map((section) => (
					<div key={section.labelKey} className="space-y-3">
						<Eyebrow as="h2" className="px-4">
							{t(section.labelKey)}
						</Eyebrow>
						<nav aria-label={t(section.labelKey)} className="space-y-px">
							{section.items.map((item) => {
								const active = isActiveSettingsPath(pathname, item.href);
								return (
									<Link
										key={item.href}
										href={item.href}
										aria-current={active ? "page" : undefined}
										className={cn(
											"block border-s-2 px-4 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus",
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
				))}
			</div>
		</SectionNavSheet>
	);
}
