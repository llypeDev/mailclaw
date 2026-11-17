"use client";

import Link from "next/link";
import { Menu } from "@/components/icons";
import { useBranding } from "./branding-provider";
import { useSidebar } from "./sidebar-state";
import type { SidebarHeaderProps } from "./sidebar-state-types";
import { Tooltip } from "./ui/tooltip";
import { useLanguage } from "./language-provider";

export function SidebarHeader({ href, label }: SidebarHeaderProps) {
	const { t } = useLanguage();
	const branding = useBranding();
	const { minimal, toggle } = useSidebar();
	// The branding icon is an API route or a small static PNG at a fixed size, so next/image has nothing to optimise.
	/* eslint-disable @next/next/no-img-element */
	const toggleButton = <button type="button" onClick={toggle} className="flex h-10 w-10 shrink-0 items-center justify-center text-fg-muted hover:bg-surface-hover hover:text-fg" aria-label={minimal ? t("navigation.expandMenu") : t("navigation.collapseMenu")}>
		{minimal ? <img src={branding.iconUrl} height={32} width={32} alt="" /> : <Menu size={20} />}
	</button>;
	return (
		<div className={`mb-3 flex h-10 items-center ${minimal ? "" : "gap-2 px-1"}`}>
			{minimal ? <Tooltip label={t("navigation.expandMenu")} placement="right">{toggleButton}</Tooltip> : toggleButton}
			{!minimal && <Link href={href} className="flex min-w-0 items-center gap-3"><img src={branding.iconUrl} height={32} width={32} alt="" /><span className="truncate font-display text-lg font-bold tracking-tight text-fg">{label ?? branding.appName}</span></Link>}
		</div>
	);
	/* eslint-enable @next/next/no-img-element */
}
