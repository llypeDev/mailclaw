"use client";

import { OrangeProvider, enUS } from "@orangesys/ui";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useLanguage } from "@/components/language-provider";
import { applyTheme, readThemePreference, resolveTheme, THEME_CHANGED_EVENT, type ResolvedTheme } from "@/components/theme-utils";
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
	const theme = useSyncExternalStore(subscribeTheme, currentTheme, serverTheme);
	// Orange writes `data-theme` on <html> in an effect, and while hydrating it still has the server's guess.
	// A parent's effects run after its children's in the same flush (before paint), so re-applying the
	// preference here keeps the attribute the bootstrap script set.
	useEffect(() => applyTheme(readThemePreference()), [theme]);
	// Orange's built-in texts come from the Mailclaw catalog (`orange.*` keys), so they follow the interface
	// language. `t` changes only with the locale or its catalog, so this is rebuilt once per language. The
	// Mailclaw locale also drives Orange's own Intl number and date formatting.
	const messages = useMemo(() => orangeMessages(enUS, t), [t]);
	return (
		<OrangeProvider theme={theme} locale={locale} messages={messages}>
			{children}
		</OrangeProvider>
	);
}
