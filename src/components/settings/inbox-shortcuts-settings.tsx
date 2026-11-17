"use client";

import { useState } from "react";
import { useLanguage } from "@/components/language-provider";
import { useShortcuts } from "@/components/shortcuts";
import { Switch } from "@/components/ui/switch";
import { SETTING_DESCRIPTION_CLASS, SETTING_ERROR_CLASS, SETTING_ROWS_CLASS, SETTING_ROW_CLASS, SETTING_TITLE_CLASS } from "./settings-section-utils";

export function InboxShortcutsSettings() {
	const { t } = useLanguage();
	const {
		shortcutsEnabled,
		shortcutsPreferenceLoading,
		shortcutsPreferenceError,
		setShortcutsEnabled,
	} = useShortcuts();
	const [saving, setSaving] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);

	return (
		<div>
			<div className={SETTING_ROWS_CLASS}>
				<label className={SETTING_ROW_CLASS}>
					<span className="flex-1">
						<span className={SETTING_TITLE_CLASS}>{t("settings.shortcuts.title")}</span>
						<span className={SETTING_DESCRIPTION_CLASS}>
							{t("settings.shortcuts.description")}
						</span>
					</span>
					<Switch
						checked={shortcutsEnabled}
						disabled={shortcutsPreferenceLoading || saving}
						onCheckedChange={(enabled) => {
							setSaving(true);
							setSaveError(null);
							void setShortcutsEnabled(enabled)
								.catch((error) => setSaveError(error instanceof Error ? error.message : t("settings.shortcuts.failed")))
								.finally(() => setSaving(false));
						}}
						aria-label={t("settings.shortcuts.enable")}
					/>
				</label>
			</div>
			{(saveError || shortcutsPreferenceError) && (
				<p role="alert" className={SETTING_ERROR_CLASS}>{saveError || shortcutsPreferenceError}</p>
			)}
		</div>
	);
}
