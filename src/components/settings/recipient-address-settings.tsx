"use client";

import { useState } from "react";
import { useShowFullRecipientAddresses } from "@/components/messages/use-show-full-recipient-addresses";
import { useLanguage } from "@/components/language-provider";
import { Switch } from "@/components/ui/switch";
import { SETTING_DESCRIPTION_CLASS, SETTING_ERROR_CLASS, SETTING_ROWS_CLASS, SETTING_ROW_CLASS, SETTING_TITLE_CLASS } from "./settings-section-utils";

export function RecipientAddressSettings() {
	const { t } = useLanguage();
	const { enabled, error, isLoading, setEnabled } = useShowFullRecipientAddresses();
	const [saving, setSaving] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);

	return (
		<div>
			<div className={SETTING_ROWS_CLASS}>
				<label className={SETTING_ROW_CLASS}>
					<span className="flex-1">
						<span className={SETTING_TITLE_CLASS}>{t("settings.recipient.title")}</span>
						<span className={SETTING_DESCRIPTION_CLASS}>
							{t("settings.recipient.description")}
						</span>
					</span>
					<Switch
						checked={enabled}
						disabled={isLoading || saving}
						onCheckedChange={(next) => {
							setSaving(true);
							setSaveError(null);
							void setEnabled(next)
								.catch((updateError) => setSaveError(updateError instanceof Error ? updateError.message : t("settings.recipient.failed")))
								.finally(() => setSaving(false));
						}}
						aria-label={t("settings.recipient.title")}
					/>
				</label>
			</div>
			{(saveError || error) && <p role="alert" className={SETTING_ERROR_CLASS}>{saveError || error}</p>}
		</div>
	);
}
