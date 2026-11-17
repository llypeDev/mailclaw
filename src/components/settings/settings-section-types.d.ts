import type { HTMLAttributes, ReactNode } from "react";

export type SettingsPageHeaderProps = {
	/** The settings area the page belongs to ("Settings", "Mailbox"), shown as Orange's eyebrow. */
	eyebrow: ReactNode;
	/** The page's h1. */
	title: ReactNode;
	description?: ReactNode;
	/** The page's one primary action, aligned to the end of the title row. */
	actions?: ReactNode;
};

export type SettingsSectionProps = {
	id?: string;
	title: ReactNode;
	/** Something small that sits beside the heading, outside it (an info tooltip button). */
	titleAside?: ReactNode;
	description?: ReactNode;
	/** Actions that belong to the whole section, aligned with its heading. */
	actions?: ReactNode;
	className?: string;
	children?: ReactNode;
};

export type SettingsSubsectionProps = SettingsSectionProps;

export type SettingsPanelProps = HTMLAttributes<HTMLDivElement>;
