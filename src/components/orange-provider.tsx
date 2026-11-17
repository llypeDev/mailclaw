"use client";

import { OrangeProvider, enUS } from "@orangesys/ui";
import { useMemo, useSyncExternalStore } from "react";
import { useLanguage } from "@/components/language-provider";
import { readThemePreference, resolveTheme, THEME_CHANGED_EVENT, type ResolvedTheme } from "@/components/theme-utils";
import { orangeMessages } from "@/components/orange-provider-utils";

function subscribeTheme(onChange: () => void) {
	const scheme = window.matchMedia("(prefers-color-scheme: dark)");
	const contrast = window.matchMedia("(prefers-contrast: more)");
	scheme.addEventListener("change", onChange);
	contrast.addEventListener("change", onChange);
	window.addEventListener(THEME_CHANGED_EVENT, onChange);
	window.addEventListener("storage", onChange);
	return () => {
		scheme.removeEventListener("change", onChange);
		contrast.removeEventListener("change", onChange);
		window.removeEventListener(THEME_CHANGED_EVENT, onChange);
		window.removeEventListener("storage", onChange);
	};
}

const currentTheme = (): ResolvedTheme => resolveTheme(readThemePreference());
const serverTheme = (): ResolvedTheme => "light";

/** Orange's provider, fed by Mailclaw's theme preference (theme-utils.ts) and interface language. */
export function MailclawOrangeProvider({ children }: { children: React.ReactNode }) {
	const { locale, t } = useLanguage();
	// `data-theme` on <html> belongs to Mailclaw: the bootstrap script sets it before paint and ThemeSync keeps
	// it current. `themeTarget="none"` stops Orange from writing its own guess over it while hydrating; Orange
	// still gets the resolved theme for its context (colour scheme, high contrast).
	const theme = useSyncExternalStore(subscribeTheme, currentTheme, serverTheme);
	// Orange's built-in texts come from the Mailclaw catalog (`orange.*` keys), so they follow the interface
	// language. `t` changes only with the locale or its catalog, so this is rebuilt once per language. The
	// Mailclaw locale also drives Orange's own Intl number and date formatting.
	const messages = useMemo(() => orangeMessages(enUS, t), [t]);
	return (
		<OrangeProvider theme={theme} themeTarget="none" locale={locale} messages={messages}>
			{children}
		</OrangeProvider>
	);
}
