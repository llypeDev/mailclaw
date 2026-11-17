"use client";

import { useEffect } from "react";
import { applyTheme, readThemePreference, THEME_CHANGED_EVENT } from "@/components/theme-utils";

// Keeps the html theme in step with the saved preference and, for "system", with the OS colour scheme and
// contrast settings.
export function ThemeSync() {
	useEffect(() => {
		const media = window.matchMedia("(prefers-color-scheme: dark)");
		const contrast = window.matchMedia("(prefers-contrast: more)");
		const sync = () => applyTheme(readThemePreference());
		sync();
		media.addEventListener("change", sync);
		contrast.addEventListener("change", sync);
		window.addEventListener(THEME_CHANGED_EVENT, sync);
		window.addEventListener("storage", sync);
		return () => {
			media.removeEventListener("change", sync);
			contrast.removeEventListener("change", sync);
			window.removeEventListener(THEME_CHANGED_EVENT, sync);
			window.removeEventListener("storage", sync);
		};
	}, []);
	return null;
}
