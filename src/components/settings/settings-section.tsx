"use client";

import { Heading, PageHeader, Text, type HeadingProps, type TextProps } from "@orangesys/ui";
import { useId } from "react";
import { cn } from "@/lib/utils";
import type {
	SettingsPageHeaderProps,
	SettingsPanelProps,
	SettingsSectionProps,
	SettingsSubsectionProps,
} from "./settings-section-types";
import { SETTING_PANEL_CLASS } from "./settings-section-utils";

export type {
	SettingsPageHeaderProps,
	SettingsPanelProps,
	SettingsSectionProps,
	SettingsSubsectionProps,
} from "./settings-section-types";

/** Top of a settings page: the area as an eyebrow, the page as its h1, an optional line of context. */
export function SettingsPageHeader({ eyebrow, title, description, actions }: SettingsPageHeaderProps) {
	return <PageHeader eyebrow={eyebrow} title={title} description={description} actions={actions} className="pb-0" />;
}

/** One subject of a settings page, ruled off from the one above by a 1px line. */
export function SettingsSection({ id, title, titleAside, description, actions, className, children }: SettingsSectionProps) {
	const headingId = useId();
	return (
		<section id={id} aria-labelledby={headingId} className={cn("scroll-mt-6 space-y-5 border-t border-line pt-8", className)}>
			<div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
				<div className="min-w-0 flex-[1_1_18rem]">
					{titleAside ? (
						<div className="flex items-center gap-2">
							<Heading level={2} size="lg" id={headingId}>{title}</Heading>
							{titleAside}
						</div>
					) : (
						<Heading level={2} size="lg" id={headingId}>{title}</Heading>
					)}
					{description ? <Text size="sm" tone="muted" className="mt-1">{description}</Text> : null}
				</div>
				{actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
			</div>
			{children}
		</section>
	);
}

/** A group of settings inside a section, under an h3. */
export function SettingsSubsection({ id, title, titleAside, description, actions, className, children }: SettingsSubsectionProps) {
	return (
		<div id={id} className={cn("scroll-mt-6 space-y-3", className)}>
			<div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
				<div className="min-w-0 flex-[1_1_18rem]">
					{titleAside ? (
						<div className="flex items-center gap-2">
							<Heading level={3} size="md">{title}</Heading>
							{titleAside}
						</div>
					) : (
						<Heading level={3} size="md">{title}</Heading>
					)}
					{description ? <Text size="sm" tone="muted" className="mt-1">{description}</Text> : null}
				</div>
				{actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
			</div>
			{children}
		</div>
	);
}

/** A 1px frame on the surface colour that holds a form or a list. */
export function SettingsPanel({ className, ...props }: SettingsPanelProps) {
	return <div className={cn(SETTING_PANEL_CLASS, className)} {...props} />;
}

// Orange's Heading and Text through this client module, so server-rendered pages can use them too.
export function SettingsHeading(props: HeadingProps) {
	return <Heading {...props} />;
}

export function SettingsText(props: TextProps) {
	return <Text {...props} />;
}
