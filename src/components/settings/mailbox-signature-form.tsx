"use client";

import { Eyebrow } from "@orangesys/ui";
import { useState } from "react";
import { useLanguage } from "@/components/language-provider";
import { useSelectedMailbox } from "@/components/mailbox-provider";
import { isHtmlSignature } from "@/components/compose/rich-text-utils";
import { EmailHtmlRenderer } from "@/components/messages/email-html-renderer";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SETTING_HINT_CLASS, SETTING_STATUS_CLASS } from "./settings-section-utils";
import { updateMailboxSignature } from "./utils";

export function MailboxSignatureForm() {
	const { t } = useLanguage();
	const { selectedMailbox, setSelectedMailbox, isLoading } = useSelectedMailbox();
	const [signature, setSignature] = useState(selectedMailbox?.signature ?? "");
	const [savedSignature, setSavedSignature] = useState(selectedMailbox?.signature ?? "");
	const [status, setStatus] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const [syncedMailbox, setSyncedMailbox] = useState({ id: selectedMailbox?.id, signature: selectedMailbox?.signature });

	if (syncedMailbox.id !== selectedMailbox?.id || syncedMailbox.signature !== selectedMailbox?.signature) {
		const nextSignature = selectedMailbox?.signature ?? "";
		setSyncedMailbox({ id: selectedMailbox?.id, signature: selectedMailbox?.signature });
		setSignature(nextSignature);
		setSavedSignature(nextSignature);
		setStatus(null);
	}

	async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!selectedMailbox) return;
		setSaving(true);
		setStatus(null);
		try {
			const saved = await updateMailboxSignature(selectedMailbox.id, signature);
			setSignature(saved);
			setSavedSignature(saved);
			setSelectedMailbox({ ...selectedMailbox, signature: saved });
			setStatus(t("common.saved"));
		} catch (error) {
			setStatus(error instanceof Error ? error.message : t("settings.signature.failed"));
		} finally {
			setSaving(false);
		}
	}

	if (isLoading) return <p className="text-sm text-fg-muted">{t("settings.signature.loadingInbox")}</p>;
	if (!selectedMailbox) return <p className="text-sm text-fg-muted">{t("settings.signature.selectInbox")}</p>;

	const address = `${selectedMailbox.localPart}@${selectedMailbox.hostname}`;
	const canManage = selectedMailbox.permission === "full_access";

	return (
		<form onSubmit={onSubmit} className="space-y-4">
			<div className="space-y-2">
				<Label htmlFor="mailboxSignature">{t("settings.signature.for", { address })}</Label>
				<Textarea
					id="mailboxSignature"
					value={signature}
					onChange={(event) => setSignature(event.target.value)}
					placeholder={t("settings.signature.placeholder")}
					rows={6}
					disabled={!canManage || saving}
				/>
				<p className={SETTING_HINT_CLASS}>
					{t("settings.signature.hint")}
				</p>
			</div>
			{isHtmlSignature(signature) && (
				<div className="space-y-2">
					<Eyebrow>{t("settings.signature.preview")}</Eyebrow>
					<EmailHtmlRenderer
						className="border border-line bg-surface p-4 text-sm text-fg"
						html={signature}
					/>
				</div>
			)}
			<div className="flex items-center gap-3">
				<Button type="submit" disabled={!canManage || saving || signature.trim() === savedSignature}>
					{saving ? t("common.saving") : t("settings.signature.save")}
				</Button>
				{!canManage && <p className={SETTING_STATUS_CLASS}>{t("settings.signature.needFullAccess")}</p>}
				{status && <p role="status" className={SETTING_STATUS_CLASS}>{status}</p>}
			</div>
		</form>
	);
}
