"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "@/components/language-provider";
import { authFetch } from "@/lib/auth/client";
import { TRASH_RETENTION_OPTIONS, describeTrashRetention } from "@/lib/email/trash-retention-utils";
import type { TrashRetentionSettingsResponse } from "@/app/api/settings/trash-retention/types";
import { Select } from "@/components/ui/select";
import { SETTING_DESCRIPTION_CLASS, SETTING_ERROR_CLASS, SETTING_ROWS_CLASS, SETTING_ROW_CLASS, SETTING_TITLE_CLASS } from "./settings-section-utils";

export function TrashRetentionSettings() {
	const { t } = useLanguage();
	const [days, setDays] = useState<number | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		void authFetch("/api/settings/trash-retention")
			.then(async (response) => {
				const data = await response.json() as TrashRetentionSettingsResponse;
				if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : t("settings.trash.loadFailed"));
				setDays(data.days ?? null);
			})
			.catch((nextError) => setError(nextError instanceof Error ? nextError.message : t("settings.trash.loadFailed")))
			.finally(() => setLoading(false));
		// eslint-disable-next-line react-hooks/exhaustive-deps -- load once on mount; `t` only words the error, and a language switch must not refetch over the selection
	}, []);

	async function updateDays(nextDays: number | null) {
		const previous = days;
		setDays(nextDays);
		setLoading(true);
		setError(null);
		try {
			const response = await authFetch("/api/settings/trash-retention", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ days: nextDays }),
			});
			const data = await response.json() as TrashRetentionSettingsResponse;
			if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : t("settings.trash.updateFailed"));
			setDays(data.days ?? null);
		} catch (nextError) {
			setDays(previous);
			setError(nextError instanceof Error ? nextError.message : t("settings.trash.updateFailed"));
		} finally {
			setLoading(false);
		}
	}

	// Keep a custom value set through the API selectable instead of silently showing "Never".
	const options: number[] = days && !(TRASH_RETENTION_OPTIONS as readonly number[]).includes(days)
		? [...TRASH_RETENTION_OPTIONS, days].sort((a, b) => a - b)
		: [...TRASH_RETENTION_OPTIONS];

	return (
		<div>
			<div className={SETTING_ROWS_CLASS}>
				<label className={SETTING_ROW_CLASS}>
					<span className="min-w-0 flex-1">
						<span className={SETTING_TITLE_CLASS}>{t("settings.trash.title")}</span>
						<span className={SETTING_DESCRIPTION_CLASS}>
							{t("settings.trash.description")}
						</span>
					</span>
					<Select
						value={days ?? ""}
						disabled={loading}
						onChange={(event) => void updateDays(event.target.value ? Number(event.target.value) : null)}
						className="py-1.5 text-sm text-fg"
						aria-label={t("settings.trash.title")}
					>
						<option value="">{describeTrashRetention(null, t)}</option>
						{options.map((value) => (
							<option key={value} value={value}>{describeTrashRetention(value, t)}</option>
						))}
					</Select>
				</label>
			</div>
			{error && <p role="alert" className={SETTING_ERROR_CLASS}>{error}</p>}
		</div>
	);
}
