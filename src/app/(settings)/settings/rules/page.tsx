import { getServerTranslator } from "@/lib/i18n/server";
import { InboxRules } from "@/components/settings/inbox-rules";
import { DomainRouting } from "@/components/settings/domain-routing/domain-routing";
import { SettingsPageHeader } from "@/components/settings/settings-section";

export default async function SettingsRulesPage() {
	const t = await getServerTranslator();
	return (
		<div className="space-y-8 py-4">
			<SettingsPageHeader eyebrow={t("settings.nav.settings")} title={t("settings.nav.rules")} />
			<DomainRouting />
			<InboxRules />
		</div>
	);
}
