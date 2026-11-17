"use client";

import { Alert } from "@orangesys/ui";
import { useState } from "react";
import { useLanguage } from "@/components/language-provider";
import { useSelectedMailbox } from "@/components/mailbox-provider";
import { Button } from "@/components/ui/button";
import { SettingsPageHeader, SettingsPanel, SettingsSection } from "@/components/settings/settings-section";
import type { ExportState } from "./types";
import { exportMailbox } from "./utils";

export default function SettingsExportPage() {
	const { t } = useLanguage();
	const { selectedMailbox } = useSelectedMailbox();
	const [exportState, setExportState] = useState<ExportState>({ error: null, loading: false });

	async function onExport() {
		if (!selectedMailbox?.id) return;
		setExportState({ error: null, loading: true });
		try {
			await exportMailbox(selectedMailbox.id, `${selectedMailbox.localPart}.mbox`);
		} catch (error) {
			setExportState({ error: error instanceof Error ? error.message : t("export.failed"), loading: false });
			return;
		}
		setExportState({ error: null, loading: false });
	}

	return (
		<div className="space-y-8 py-4">
			<SettingsPageHeader eyebrow={t("settings.nav.mailbox")} title={t("settings.nav.export")} />
			<SettingsSection title={t("export.title")} description={t("export.description")}>
				<SettingsPanel className="space-y-3">
					<Button type="button" disabled={!selectedMailbox || exportState.loading} onClick={onExport}>
						{exportState.loading ? t("export.preparing") : t("export.download")}
					</Button>
					{exportState.error && (
						<Alert tone="danger" live>
							{exportState.error}
						</Alert>
					)}
				</SettingsPanel>
			</SettingsSection>
		</div>
	);
}
