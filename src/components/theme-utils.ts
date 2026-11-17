export type ThemePreference = "light" | "dark" | "light-hc" | "dark-hc" | "system";
export type ResolvedTheme = Exclude<ThemePreference, "system">;

export const THEME_STORAGE_KEY = "mailclaw-theme";
export const THEME_CHANGED_EVENT = "mailclaw:theme-changed";

// Runs in <head> before paint, so the first frame already has the right theme (same approach as the
// sidebar width). It sets Orange's `data-theme` and keeps the `.dark` class for `dark:` variants.
// Keep it in sync with resolveTheme/applyTheme below.
export const themeBootstrapScript = `(() => {
	try {
		const saved = localStorage.getItem("mailclaw-theme");
		let theme = /^(light|dark)(-hc)?$/.test(saved || "") ? saved : "";
		if (!theme) {
			theme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
			if (matchMedia("(prefers-contrast: more)").matches) theme += "-hc";
		}
		const root = document.documentElement;
		root.setAttribute("data-theme", theme);
		root.classList.toggle("dark", theme.startsWith("dark"));
		root.classList.toggle("light", theme.startsWith("light"));
	} catch {}
})();`;

export function isThemePreference(value: unknown): value is ThemePreference {
	return value === "light" || value === "dark" || value === "light-hc" || value === "dark-hc" || value === "system";
}

export function readThemePreference(): ThemePreference {
	if (typeof window === "undefined") return "system";
	try {
		const saved = localStorage.getItem(THEME_STORAGE_KEY);
		return isThemePreference(saved) ? saved : "system";
	} catch {
		return "system";
	}
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
	if (preference !== "system") return preference;
	if (typeof window === "undefined") return "light";
	const base = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
	return window.matchMedia("(prefers-contrast: more)").matches ? `${base}-hc` : base;
}

export function applyTheme(preference: ThemePreference): void {
	if (typeof document === "undefined") return;
	const theme = resolveTheme(preference);
	const root = document.documentElement;
	root.setAttribute("data-theme", theme);
	root.classList.toggle("dark", theme.startsWith("dark"));
	root.classList.toggle("light", theme.startsWith("light"));
}

export function saveThemePreference(preference: ThemePreference): void {
	try {
		if (preference === "system") localStorage.removeItem(THEME_STORAGE_KEY);
		else localStorage.setItem(THEME_STORAGE_KEY, preference);
	} catch {
		// Storage can be unavailable in private windows; the theme still applies for this page.
	}
	applyTheme(preference);
	if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(THEME_CHANGED_EVENT, { detail: preference }));
}
