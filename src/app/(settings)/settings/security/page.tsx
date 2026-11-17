import { getServerTranslator } from "@/lib/i18n/server";
import { PasswordSettings } from "@/components/settings/password-settings";
import { PasskeySettings } from "@/components/settings/passkey-settings";
import { TwoStepSettings } from "@/components/settings/two-step-settings";
import { DeviceSettings } from "@/components/settings/device-settings";
import { SettingsHeading, SettingsPageHeader, SettingsPanel, SettingsSection, SettingsText } from "@/components/settings/settings-section";
import { SETTING_STACK_CLASS } from "@/components/settings/settings-section-utils";

export default async function SecuritySettingsPage() {
	const t = await getServerTranslator();
	return <div className="space-y-8 py-4">
		<SettingsPageHeader eyebrow={t("settings.nav.settings")} title={t("settingsPage.security.title")} description={t("settingsPage.security.description")} />
		<SettingsSection title={t("signIn.methodsTitle")} description={t("signIn.methodsDescription")}>
			<div className={SETTING_STACK_CLASS}>
				<SettingsPanel className="space-y-4">
					<SettingsHeading level={3} size="md">{t("signIn.passwordTitle")}</SettingsHeading>
					<PasswordSettings />
				</SettingsPanel>
				<SettingsPanel id="passkeys" className="scroll-mt-6 space-y-4">
					<div>
						<SettingsHeading level={3} size="md">{t("passkey.settingsTitle")}</SettingsHeading>
						<SettingsText size="sm" tone="muted" className="mt-1">{t("passkey.settingsDescription")}</SettingsText>
					</div>
					<PasskeySettings />
				</SettingsPanel>
			</div>
		</SettingsSection>
		<TwoStepSettings />
		<SettingsSection title={t("settingsPage.security.devices")} description={t("settingsPage.security.devicesDescription")}>
			<DeviceSettings />
		</SettingsSection>
	</div>;
}
