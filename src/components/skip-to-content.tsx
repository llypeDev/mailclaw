"use client";

import { useLanguage } from "@/components/language-provider";

export function SkipToContent() {
	const { t } = useLanguage();
	return (
		<a
			href="#main-content"
			className="sr-only focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-[100] focus:border focus:border-line focus:bg-surface-raised focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-accent-text focus:shadow-lg focus:outline-2 focus:outline-offset-2 focus:outline-focus"
		>
			{t("a11y.skipToContent")}
		</a>
	);
}
