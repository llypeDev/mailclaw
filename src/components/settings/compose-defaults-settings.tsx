"use client";

import { useEffect, useState } from "react";
import { loadComposePreferences, updateComposePreferences } from "@/components/compose/compose-preferences-utils";
import { useLanguage } from "@/components/language-provider";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { DEFAULT_UNDO_SEND_SECONDS, UNDO_SEND_OPTIONS, parseUndoSendSeconds } from "@/lib/compose/compose-utils";
import type { ComposePreferences } from "@/lib/compose/types";
import { SETTING_DESCRIPTION_CLASS, SETTING_ERROR_CLASS, SETTING_ROWS_CLASS, SETTING_ROW_CLASS, SETTING_TITLE_CLASS } from "./settings-section-utils";

/** Account-wide composer defaults; each message can still change the read receipt in the composer. */
export function ComposeDefaultsSettings() {
	const { t } = useLanguage();
	const [preferences, setPreferences] = useState<ComposePreferences>({ trackOpensDefault: false, undoSendSeconds: DEFAULT_UNDO_SEND_SECONDS });
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let active = true;
		void loadComposePreferences()
			.then((loaded) => {
				if (active) setPreferences(loaded);
			})
			.catch(() => {
				if (active) setError(t("settings.compose.failed"));
			})
			.finally(() => {
				if (active) setLoading(false);
			});
		return () => {
			active = false;
		};
	}, [t]);

	function change(patch: Partial<ComposePreferences>) {
		const previous = preferences;
		setPreferences({ ...preferences, ...patch });
		setSaving(true);
		setError(null);
		void updateComposePreferences(patch)
			.then(setPreferences)
			.catch((saveError) => {
				setPreferences(previous);
				setError(saveError instanceof Error && saveError.message === "MIGRATION_REQUIRED" ? t("settings.compose.migrationRequired") : t("settings.compose.failed"));
			})
			.finally(() => setSaving(false));
	}

	return (
		<div>
			<div className={SETTING_ROWS_CLASS}>
				<label className={SETTING_ROW_CLASS}>
					<span className="min-w-0 flex-1">
						<span className={SETTING_TITLE_CLASS}>{t("settings.compose.trackOpensTitle")}</span>
						<span className={SETTING_DESCRIPTION_CLASS}>{t("settings.compose.trackOpensDescription")}</span>
					</span>
					<Switch
						checked={preferences.trackOpensDefault}
						disabled={loading || saving}
						onCheckedChange={(trackOpensDefault) => change({ trackOpensDefault })}
						aria-label={t("settings.compose.trackOpensTitle")}
					/>
				</label>
				<div className={SETTING_ROW_CLASS}>
					<span className="min-w-0 flex-1">
						<label htmlFor="compose-undo-send" className={SETTING_TITLE_CLASS}>{t("settings.compose.undoTitle")}</label>
						<span className={SETTING_DESCRIPTION_CLASS}>{t("settings.compose.undoDescription")}</span>
					</span>
					<Select
						id="compose-undo-send"
						value={String(preferences.undoSendSeconds)}
						disabled={loading || saving}
						className="py-1.5 text-sm text-fg"
						onChange={(event) => {
							const undoSendSeconds = parseUndoSendSeconds(event.target.value);
							if (undoSendSeconds !== null) change({ undoSendSeconds });
						}}
					>
						{UNDO_SEND_OPTIONS.map((seconds) => (
							<option key={seconds} value={seconds}>
								{seconds === 0 ? t("settings.compose.undoOff") : t("settings.compose.undoSeconds", { seconds })}
							</option>
						))}
					</Select>
				</div>
			</div>
			{error && <p role="alert" className={SETTING_ERROR_CLASS}>{error}</p>}
		</div>
	);
}
