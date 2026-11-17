import { getServerTranslator } from "@/lib/i18n/server";
import { EmailClientsSettings } from "@/components/settings/email-clients-settings";
import { SettingsPageHeader, SettingsPanel } from "@/components/settings/settings-section";

export default async function EmailAppsSettingsPage() {
	const t = await getServerTranslator();
	return <div className="space-y-8 py-4">
		<SettingsPageHeader eyebrow={t("settings.nav.settings")} title={t("settingsPage.appPasswords.title")} description={t("settingsPage.appPasswords.description")} />
		<div className="border-t border-line pt-8">
			<SettingsPanel>
				<EmailClientsSettings />
			</SettingsPanel>
		</div>
	</div>;
}
