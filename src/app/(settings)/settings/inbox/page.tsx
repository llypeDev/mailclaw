import { getServerTranslator } from "@/lib/i18n/server";
import { AppearanceSettings } from "@/components/settings/appearance-settings";
import { InboxThreadingSettings } from "@/components/settings/inbox-threading-settings";
import { RemoteContentSettings } from "@/components/settings/remote-content-settings";
import { RecipientAddressSettings } from "@/components/settings/recipient-address-settings";
import { ComposeDefaultsSettings } from "@/components/settings/compose-defaults-settings";
import { InboxReadingLayoutSettings } from "@/components/settings/inbox-reading-layout-settings";
import { InboxShortcutsSettings } from "@/components/settings/inbox-shortcuts-settings";
import { MailboxAutoReplyForm } from "@/components/settings/mailbox-auto-reply-form";
import { SpamFilterSettings } from "@/components/settings/spam-filter-settings";
import { TrashRetentionSettings } from "@/components/settings/trash-retention-settings";
import { PushNotificationSettings } from "@/components/settings/push-notification-settings";
import { BrowserNotificationSettings } from "@/components/settings/browser-notification-settings";
import { SettingsPageHeader, SettingsSection, SettingsSubsection } from "@/components/settings/settings-section";

export default async function SettingsInboxPage() {
	const t = await getServerTranslator();
	return (
		<div className="space-y-8 py-4">
			<SettingsPageHeader eyebrow={t("settings.nav.settings")} title={t("settings.nav.inbox")} />
			<SettingsSection title={t("settingsPage.inbox.experience")} description={t("settingsPage.inbox.experienceDescription")}>
				<div className="space-y-8">
					<SettingsSubsection title={t("settingsPage.inbox.appearance")} description={t("settingsPage.inbox.appearanceDescription")}>
						<AppearanceSettings />
					</SettingsSubsection>
					<SettingsSubsection title={t("settingsPage.inbox.readingLayout")} description={t("settingsPage.inbox.readingLayoutDescription")}>
						<InboxReadingLayoutSettings />
					</SettingsSubsection>
					<SettingsSubsection title={t("settingsPage.inbox.threading")} description={t("settingsPage.inbox.threadingDescription")}>
						<InboxThreadingSettings />
					</SettingsSubsection>
					<SettingsSubsection title={t("settingsPage.inbox.addresses")} description={t("settingsPage.inbox.addressesDescription")}>
						<RecipientAddressSettings />
					</SettingsSubsection>
					<SettingsSubsection title={t("settingsPage.inbox.compose")} description={t("settingsPage.inbox.composeDescription")}>
						<ComposeDefaultsSettings />
					</SettingsSubsection>
					<SettingsSubsection title={t("settingsPage.inbox.shortcuts")} description={t("settingsPage.inbox.shortcutsDescription")}>
						<InboxShortcutsSettings />
					</SettingsSubsection>
					<SettingsSubsection title={t("settingsPage.inbox.notifications")} description={t("settingsPage.inbox.notificationsDescription")}>
						<div className="space-y-3">
							<BrowserNotificationSettings />
							<PushNotificationSettings />
						</div>
					</SettingsSubsection>
				</div>
			</SettingsSection>
			<SettingsSection title={t("settingsPage.inbox.handling")} description={t("settingsPage.inbox.handlingDescription")}>
				<div className="space-y-8">
					<SettingsSubsection title={t("settingsPage.inbox.spamProtection")} description={t("settingsPage.inbox.spamProtectionDescription")}>
						<SpamFilterSettings />
					</SettingsSubsection>
					<SettingsSubsection title={t("settingsPage.inbox.remoteContent")} description={t("settingsPage.inbox.remoteContentDescription")}>
						<RemoteContentSettings />
					</SettingsSubsection>
					<SettingsSubsection title={t("settingsPage.inbox.cleanup")} description={t("settingsPage.inbox.cleanupDescription")}>
						<TrashRetentionSettings />
					</SettingsSubsection>
					<SettingsSubsection title={t("settingsPage.inbox.autoReply")} description={t("settingsPage.inbox.autoReplyDescription")}>
						<MailboxAutoReplyForm />
					</SettingsSubsection>
				</div>
			</SettingsSection>
		</div>
	);
}
