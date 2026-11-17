"use client";

import { useSyncExternalStore } from "react";
import { useLanguage } from "@/components/language-provider";
import type { TranslationKey } from "@/lib/i18n/types";
import { Select } from "@/components/ui/select";
import {
	isThemePreference,
	readThemePreference,
	saveThemePreference,
	THEME_CHANGED_EVENT,
	type ThemePreference,
} from "@/components/theme-utils";
import { SETTING_DESCRIPTION_CLASS, SETTING_ROWS_CLASS, SETTING_ROW_CLASS, SETTING_TITLE_CLASS } from "./settings-section-utils";

const OPTIONS: { value: ThemePreference; labelKey: TranslationKey }[] = [
	{ value: "system", labelKey: "settings.theme.system" },
	{ value: "light", labelKey: "settings.theme.light" },
	{ value: "dark", labelKey: "settings.theme.dark" },
	{ value: "light-hc", labelKey: "settings.theme.lightHc" },
	{ value: "dark-hc", labelKey: "settings.theme.darkHc" },
];

function subscribeThemePreference(onChange: () => void) {
	window.addEventListener(THEME_CHANGED_EVENT, onChange);
	return () => window.removeEventListener(THEME_CHANGED_EVENT, onChange);
}

const serverThemePreference = (): ThemePreference => "system";

export function AppearanceSettings() {
	const { t } = useLanguage();
	const preference = useSyncExternalStore(subscribeThemePreference, readThemePreference, serverThemePreference);

	return (
		<div className={SETTING_ROWS_CLASS}>
			<label className={SETTING_ROW_CLASS}>
				<span className="min-w-0 flex-1">
					<span className={SETTING_TITLE_CLASS}>{t("settings.theme.label")}</span>
					<span className={SETTING_DESCRIPTION_CLASS}>
						{t("settings.theme.description")}
					</span>
				</span>
				<Select
					value={preference}
					aria-label={t("settings.theme.label")}
					className="py-1.5 text-sm text-fg"
					onChange={(event) => {
						const next = event.target.value;
						if (!isThemePreference(next)) return;
						saveThemePreference(next);
					}}
				>
					{OPTIONS.map((option) => (
						<option key={option.value} value={option.value}>
							{t(option.labelKey)}
						</option>
					))}
				</Select>
			</label>
		</div>
	);
}
