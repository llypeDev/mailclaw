"use client";

import { useEffect, useState } from "react";
import { authFetch } from "@/lib/auth/client";
import { useLanguage } from "@/components/language-provider";
import { Switch } from "@/components/ui/switch";
import { SETTING_DESCRIPTION_CLASS, SETTING_ERROR_CLASS, SETTING_ROWS_CLASS, SETTING_ROW_CLASS, SETTING_TITLE_CLASS } from "./settings-section-utils";

export function SpamFilterSettings() {
	const { t } = useLanguage();
	const [enabled, setEnabled] = useState(true);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		void authFetch("/api/settings/spam")
			.then(async (response) => {
				const data = await response.json() as { enabled?: boolean; error?: string };
				if (!response.ok) throw new Error(data.error ?? t("settings.spam.loadFailed"));
				setEnabled(data.enabled !== false);
			})
			.catch((nextError) => setError(nextError instanceof Error ? nextError.message : t("settings.spam.loadFailed")))
			.finally(() => setLoading(false));
		// eslint-disable-next-line react-hooks/exhaustive-deps -- load once on mount; `t` only words the error, and a language switch must not refetch over the toggle
	}, []);

	async function updateEnabled(nextEnabled: boolean) {
		const previous = enabled;
		setEnabled(nextEnabled);
		setLoading(true);
		setError(null);
		try {
			const response = await authFetch("/api/settings/spam", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ enabled: nextEnabled }),
			});
			const data = await response.json() as { enabled?: boolean; error?: string };
			if (!response.ok) throw new Error(data.error ?? t("settings.spam.updateFailed"));
			setEnabled(data.enabled !== false);
		} catch (nextError) {
			setEnabled(previous);
			setError(nextError instanceof Error ? nextError.message : t("settings.spam.updateFailed"));
		} finally {
			setLoading(false);
		}
	}

	return (
		<div>
			<div className={SETTING_ROWS_CLASS}>
				<label className={SETTING_ROW_CLASS}>
					<span className="flex-1">
						<span className={SETTING_TITLE_CLASS}>{t("settings.spam.title")}</span>
						<span className={SETTING_DESCRIPTION_CLASS}>{t("settings.spam.description")}</span>
					</span>
					<Switch checked={enabled} disabled={loading} onCheckedChange={(value) => void updateEnabled(value)} aria-label={t("settings.spam.enable")} />
				</label>
			</div>
			{error && <p role="alert" className={SETTING_ERROR_CLASS}>{error}</p>}
		</div>
	);
}
