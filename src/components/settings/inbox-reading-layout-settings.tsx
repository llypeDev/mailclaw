"use client";

import { useLanguage } from "@/components/language-provider";
import { Switch } from "@/components/ui/switch";
import { useTwoColumnReading } from "@/components/messages/use-two-column-reading";
import { useAutoAdvanceEnabled } from "@/components/messages/use-auto-advance";
import { SETTING_DESCRIPTION_CLASS, SETTING_ROWS_CLASS, SETTING_ROW_CLASS, SETTING_TITLE_CLASS } from "./settings-section-utils";

export function InboxReadingLayoutSettings() {
	const { t } = useLanguage();
	const [twoColumnReading, setTwoColumnReading] = useTwoColumnReading();
	const [autoAdvance, setAutoAdvance] = useAutoAdvanceEnabled();

	return (
		<div className={SETTING_ROWS_CLASS}>
			<label className={SETTING_ROW_CLASS}>
				<span className="flex-1">
					<span className={SETTING_TITLE_CLASS}>{t("settings.reading.title")}</span>
					<span className={SETTING_DESCRIPTION_CLASS}>
						{t("settings.reading.description")}
					</span>
				</span>
				<Switch checked={twoColumnReading} onCheckedChange={setTwoColumnReading} aria-label={t("settings.reading.title")} />
			</label>
			<label className={SETTING_ROW_CLASS}>
				<span className="flex-1">
					<span className={SETTING_TITLE_CLASS}>{t("settings.reading.autoAdvanceTitle")}</span>
					<span className={SETTING_DESCRIPTION_CLASS}>
						{t("settings.reading.autoAdvanceDescription")}
					</span>
				</span>
				<Switch checked={autoAdvance} onCheckedChange={setAutoAdvance} aria-label={t("settings.reading.autoAdvanceTitle")} />
			</label>
		</div>
	);
}
