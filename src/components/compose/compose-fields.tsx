"use client";

import { useLanguage } from "@/components/language-provider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { RecipientInput } from "@/components/compose/recipient-input";
import type { ComposeFormMode, ComposeSenderOption } from "./compose-form-types";
import type { useComposeRecipients } from "./use-compose-recipients";

/** The header rows above the body: From, To (with the Cc/Bcc toggles), Cc, Bcc and Subject. */
export function ComposeFields({
	mode,
	senderOptions,
	senderValue,
	onSelectSender,
	recipients,
	mailboxId,
	subject,
	onSubjectChange,
	disabled,
	autoFocusTo,
}: {
	mode: ComposeFormMode;
	senderOptions: ComposeSenderOption[];
	/** `mailboxId|address` of the current sender, or "" when there is none. */
	senderValue: string;
	onSelectSender: (value: string) => void;
	recipients: ReturnType<typeof useComposeRecipients>;
	mailboxId: string | undefined;
	subject: string;
	onSubjectChange: (value: string) => void;
	/** True while a draft loads. */
	disabled: boolean;
	autoFocusTo: boolean;
}) {
	const { t } = useLanguage();
	const { to, setTo, cc, setCc, bcc, setBcc, showCc, setShowCc, showBcc, setShowBcc } = recipients;
	return (
		<>
			<div className="flex flex-row items-center border-b border-line-subtle px-4 py-1">
				<Label htmlFor={`${mode}-from`} className="w-8 shrink-0 text-sm text-fg-subtle">{t("compose.from")}</Label>
				<Select
					id={`${mode}-from`}
					value={senderValue}
					onChange={(event) => onSelectSender(event.target.value)}
					// placeholder="Select a mailbox first"
					required
					disabled={disabled || senderOptions.length === 0}
					className="h-8 px-0 py-1 text-sm shadow-none focus-visible:ring-0"
					containerClassName="flex-1 border-0 bg-transparent"
				>
					{senderOptions.length === 0 && <option value="">{t("compose.selectMailboxFirst")}</option>}
					{senderOptions.map(({ mailbox, address }) => (
						<option key={`${mailbox.id}|${address}`} value={`${mailbox.id}|${address}`}>{address}</option>
					))}
				</Select>
			</div>
			<RecipientInput
				id={`${mode}-to`}
				label={t("compose.to")}
				value={to}
				onChange={setTo}
				placeholder={t("compose.toPlaceholder")}
				mailboxId={mailboxId}
				required
				autoFocus={autoFocusTo}
				disabled={disabled}
				trailing={
					<>
						{!showCc && (
							<button type="button" className="px-1 hover:bg-surface-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-focus" onClick={() => setShowCc(true)}>
								{t("compose.cc")}
							</button>
						)}
						{!showBcc && (
							<button type="button" className="px-1 hover:bg-surface-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-focus" onClick={() => setShowBcc(true)}>
								{t("compose.bcc")}
							</button>
						)}
					</>
				}
			/>
			{showCc && (
				<RecipientInput
					id={`${mode}-cc`}
					label={t("compose.cc")}
					value={cc}
					onChange={setCc}
					placeholder={t("compose.ccPlaceholder")}
					mailboxId={mailboxId}
					disabled={disabled}
					autoFocus={!disabled && cc.length === 0}
				/>
			)}
			{showBcc && (
				<RecipientInput
					id={`${mode}-bcc`}
					label={t("compose.bcc")}
					value={bcc}
					onChange={setBcc}
					placeholder={t("compose.bccPlaceholder")}
					mailboxId={mailboxId}
					disabled={disabled}
					autoFocus={!disabled && bcc.length === 0}
				/>
			)}
			<div className="border-b border-line-subtle px-4 py-1">
				<Label htmlFor={`${mode}-subject`} className="sr-only">{t("compose.subject")}</Label>
				<Input
					id={`${mode}-subject`}
					value={subject}
					onChange={(event) => onSubjectChange(event.target.value)}
					placeholder={t("compose.subject")}
					required
					disabled={disabled}
					className="h-8 border-0 bg-transparent px-0 py-1 shadow-none focus-visible:ring-0"
				/>
			</div>
		</>
	);
}
