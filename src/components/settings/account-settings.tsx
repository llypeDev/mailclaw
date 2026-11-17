"use client";

import { Alert, Heading, Text } from "@orangesys/ui";
import { useEffect, useState } from "react";
import { useLanguage } from "@/components/language-provider";
import { LanguageSelector } from "@/components/language-selector";
import { Skeleton } from "@/components/ui/skeleton";
import { MailboxSignatureForm } from "./mailbox-signature-form";
import { ProfileForm } from "./profile-form";
import { SettingsPageHeader, SettingsPanel, SettingsSection } from "./settings-section";
import { SETTING_STACK_CLASS } from "./settings-section-utils";
import { TimeZoneForm } from "./time-zone-form";
import type { AccountSettingsResponse } from "./types";
import { loadAccountSettings } from "./utils";

export function AccountSettings() {
	const { t } = useLanguage();
	const [user, setUser] = useState<AccountSettingsResponse["user"]>();
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;

		loadAccountSettings()
			.then((nextUser) => {
				if (!cancelled) setUser(nextUser);
			})
			.catch((err) => {
				if (!cancelled) setError(err instanceof Error ? err.message : t("settings.account.loadFailed"));
			});

		return () => {
			cancelled = true;
		};
	}, [t]);

	const header = <SettingsPageHeader eyebrow={t("settings.nav.settings")} title={t("settings.nav.account")} />;

	if (error) {
		return (
			<div className="space-y-8 py-4">
				{header}
				<Alert tone="danger" live>{error}</Alert>
			</div>
		);
	}

	if (!user) {
		return (
			<div className="space-y-8 py-4">
				{header}
				<Skeleton className="h-72 w-full" />
			</div>
		);
	}

	return (
		<div className="space-y-8 py-4">
			{header}

			<SettingsSection title={t("settings.account.detailsTitle")} description={t("settings.account.detailsDescription")}>
				<div className={SETTING_STACK_CLASS}>
					<ProfileForm
						accountName={user.name}
						initialResetEmail={user.resetEmail ?? ""}
					/>

					<SettingsPanel className="space-y-4">
						<div>
							<Heading level={3} size="md">{t("settings.account.signatureTitle")}</Heading>
							<Text size="sm" tone="muted" className="mt-1">{t("settings.account.signatureDescription")}</Text>
						</div>
						<MailboxSignatureForm />
					</SettingsPanel>
				</div>
			</SettingsSection>

			<SettingsSection title={t("settings.account.generalTitle")} description={t("settings.account.generalDescription")}>
				<div className={SETTING_STACK_CLASS}>
					<SettingsPanel>
						<Heading level={3} size="md" className="mb-3">{t("language.label")}</Heading>
						<div className="max-w-xs [&>div]:px-0 [&_label]:sr-only"><LanguageSelector /></div>
					</SettingsPanel>
					<TimeZoneForm userId={user.id} initialTimeZone={user.timeZone} />
				</div>
			</SettingsSection>
		</div>
	);
}
