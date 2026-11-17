"use client";

import { useLanguage } from "@/components/language-provider";
import { Switch } from "@/components/ui/switch";
import { useConversationView } from "@/components/messages/use-conversation-view";
import { useLatestMessagesFirst } from "@/components/messages/use-latest-messages-first";
import { SETTING_DESCRIPTION_CLASS, SETTING_ROWS_CLASS, SETTING_ROW_CLASS, SETTING_TITLE_CLASS } from "./settings-section-utils";

export function InboxThreadingSettings() {
	const { t } = useLanguage();
	const [conversationView, setConversationView] = useConversationView();
	const [latestMessagesFirst, setLatestMessagesFirst] = useLatestMessagesFirst();

	return (
		<div className={SETTING_ROWS_CLASS}>
			<label className={SETTING_ROW_CLASS}>
				<span className="flex-1">
					<span className={SETTING_TITLE_CLASS}>{t("settings.threading.groupTitle")}</span>
					<span className={SETTING_DESCRIPTION_CLASS}>
						{t("settings.threading.groupDescription")}
					</span>
				</span>
				<Switch checked={conversationView} onCheckedChange={setConversationView} />
			</label>
			<label className={SETTING_ROW_CLASS}>
				<span className="flex-1">
					<span className={SETTING_TITLE_CLASS}>{t("settings.threading.latestTitle")}</span>
					<span className={SETTING_DESCRIPTION_CLASS}>
						{t("settings.threading.latestDescription")}
					</span>
				</span>
				<Switch checked={latestMessagesFirst} onCheckedChange={setLatestMessagesFirst} />
			</label>
		</div>
	);
}
