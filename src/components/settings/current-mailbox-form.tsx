"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import { Save } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { useSelectedMailbox } from "@/components/mailbox-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ProfileAvatarForm } from "./profile-avatar-form";
import { SettingsPageHeader, SettingsPanel } from "./settings-section";
import { SETTING_STATUS_CLASS } from "./settings-section-utils";
import { getMailboxAddress, updateCurrentMailboxName } from "./utils";

export function CurrentMailboxForm() {
	const { t } = useLanguage();
	const { selectedMailbox, setSelectedMailbox, isLoading } = useSelectedMailbox();
	const [displayName, setDisplayName] = useState(selectedMailbox?.displayName ?? "");
	const [savedDisplayName, setSavedDisplayName] = useState(selectedMailbox?.displayName ?? "");
	const [status, setStatus] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const [syncedMailbox, setSyncedMailbox] = useState({ id: selectedMailbox?.id, displayName: selectedMailbox?.displayName });

	if (syncedMailbox.id !== selectedMailbox?.id || syncedMailbox.displayName !== selectedMailbox?.displayName) {
		const nextName = selectedMailbox?.displayName ?? "";
		setSyncedMailbox({ id: selectedMailbox?.id, displayName: selectedMailbox?.displayName });
		setDisplayName(nextName);
		setSavedDisplayName(nextName);
		setStatus(null);
	}

	async function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!selectedMailbox) return;

		setSaving(true);
		setStatus(null);
		try {
			const updated = await updateCurrentMailboxName(selectedMailbox.id, displayName);
			setSelectedMailbox(updated);
			setSavedDisplayName(updated.displayName ?? "");
			setDisplayName(updated.displayName ?? "");
			setStatus(t("common.saved"));
		} catch (err) {
			setStatus(err instanceof Error ? err.message : t("settings.mailbox.updateFailed"));
		} finally {
			setSaving(false);
		}
	}

	if (isLoading) {
		return (
			<div className="space-y-6">
				<Skeleton className="h-8 w-32" />
				<SettingsPanel className="space-y-4">
					<Skeleton className="h-4 w-24" />
					<Skeleton className="h-10 w-full" />
					<Skeleton className="h-9 w-28" />
				</SettingsPanel>
			</div>
		);
	}

	if (!selectedMailbox) {
		return (
			<div className="space-y-6">
				<SettingsPageHeader eyebrow={t("settings.nav.mailbox")} title={t("settings.mailbox.title")} />
				<SettingsPanel className="text-sm text-fg-muted">
					{t("settings.mailbox.selectToView")}
				</SettingsPanel>
			</div>
		);
	}

	const address = getMailboxAddress(selectedMailbox);
	const hasChanges = displayName.trim() !== savedDisplayName;

	return (
		<div className="space-y-8">
			<SettingsPageHeader eyebrow={t("settings.nav.mailbox")} title={t("settings.mailbox.title")} description={<span className="font-mono">{address}</span>} />

			<SettingsPanel className="space-y-6">
				<ProfileAvatarForm
					mailboxId={selectedMailbox.id}
					initialHasAvatar={!!selectedMailbox.hasAvatar}
					name={selectedMailbox.displayName || selectedMailbox.localPart}
					colorSeed={address}
				/>
				<form onSubmit={onSubmit} className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="displayName">{t("common.name")}</Label>
						<Input
							id="displayName"
							value={displayName}
							onChange={(event) => setDisplayName(event.target.value)}
							placeholder={selectedMailbox.localPart}
							disabled={saving}
						/>
					</div>
					<div className="flex items-center gap-3">
						<Button type="submit" disabled={saving || !hasChanges}>
							<Save className="h-4 w-4" />
							{saving ? t("common.saving") : t("settings.mailbox.saveChanges")}
						</Button>
						{status && <p role="status" className={SETTING_STATUS_CLASS}>{status}</p>}
					</div>
				</form>
			</SettingsPanel>
		</div>
	);
}
