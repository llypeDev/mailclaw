"use client";

import { useId, useState, type ReactNode } from "react";
import { Eyebrow } from "@orangesys/ui";
import { AlertTriangle, CheckCircle2, ExternalLink, LoaderCircle, ShieldAlert, ShieldCheck, X } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import { splitEmailAddressList } from "@/lib/email/address";
import { formatRecipientAddressList } from "@/lib/email/recipient-display";
import type { MessageAuthenticationMethod } from "@/lib/email/authentication-types";
import { formatUserDate } from "@/lib/time/utils";
import { cn } from "@/lib/utils";
import { MessageSourceDialog } from "./message-source-dialog";
import type { MessageDetailsPanelProps } from "./message-details-types";
import { useMessageAuthentication } from "./use-message-authentication";
import {
	getOriginalSender,
	getReplyToEntries,
	hasDomainMismatchWarning,
	hasFailingAuthenticationCheck,
	hasPassingAuthenticationCheck,
	hasSenderNameAddressMismatch,
	isReplyToDifferent,
} from "./message-details-utils";

function DetailRow({ label, children, warning }: { label: string; children: ReactNode; warning?: string | null }) {
	return (
		<div className="grid gap-0.5 sm:grid-cols-[92px_minmax(0,1fr)] sm:gap-3">
			<dt className="text-fg-subtle">{label}</dt>
			<dd className="min-w-0 break-words text-fg">
				{children}
				{warning && (
					<span className="mt-0.5 flex items-start gap-1 text-warning-text">
						<AlertTriangle className="mt-px h-3 w-3 shrink-0" aria-hidden="true" />
						<span>{warning}</span>
					</span>
				)}
			</dd>
		</div>
	);
}

function statusTone(status: string | null): string {
	if (status === "PASS") return "text-success-text";
	if (status === "FAIL" || status === "SOFTFAIL" || status === "PERMERROR") return "text-danger-text";
	if (status === "TEMPERROR" || status === "NEUTRAL" || status === "NONE") return "text-warning-text";
	return "text-fg";
}

function AuthenticationRow({
	method,
	result,
	detail,
	noResult,
}: {
	method: string;
	result: MessageAuthenticationMethod | null;
	detail: string | null;
	noResult: string;
}) {
	const status = result?.status ?? null;
	const Icon = status === "PASS" ? CheckCircle2 : status === "FAIL" || status === "SOFTFAIL" || status === "PERMERROR" ? AlertTriangle : null;
	return (
		<li className="flex items-baseline gap-2">
			<span className="text-fg-disabled" aria-hidden="true">•</span>
			<span className="w-10 shrink-0 font-mono font-medium text-fg-muted">{method}</span>
			<span className="min-w-0 flex-1 break-words">
				<span className={cn("inline-flex items-center gap-1 font-medium", statusTone(status))}>
					{Icon && <Icon className="h-3 w-3 shrink-0 self-center" aria-hidden="true" />}
					{status ?? noResult}
				</span>
				{result && detail && <span className="text-fg-subtle"> · {detail}</span>}
			</span>
		</li>
	);
}

export function MessageDetailsPanel({ message, onClose, className }: MessageDetailsPanelProps) {
	const { t } = useLanguage();
	const messageSectionId = useId();
	const [sourceOpen, setSourceOpen] = useState(false);
	const { authentication, failed: authenticationFailed, loading } = useMessageAuthentication(message.id, message.direction);
	const original = getOriginalSender(message.fromAddr);
	const contactName = message.fromContactName?.trim();
	const showContactName = message.direction === "inbound" && !!contactName && contactName !== original.name;
	const replyToEntries = getReplyToEntries(message.replyTo);
	const replyToWarning = isReplyToDifferent(message);
	const senderNameWarning = hasSenderNameAddressMismatch(message);
	const hasPassingCheck = hasPassingAuthenticationCheck(authentication);
	const hasFailingCheck = hasFailingAuthenticationCheck(authentication);

	const spfDetail = authentication?.available
		? authentication.mailedBy
			? `mailed by ${authentication.mailedBy}${authentication.spf?.detail ? ` · ${authentication.spf.detail}` : ""}`
			: authentication.spf?.detail ?? null
		: null;

	return (
		<section
			aria-label={t("message.detailsTitle")}
			className={cn("overflow-hidden border border-line bg-surface text-xs", className)}
		>
			<header className="flex items-center justify-between gap-2 border-b border-line bg-canvas-subtle px-3 py-2">
				<Eyebrow as="h2">
					{t("message.detailsTitle")}
				</Eyebrow>
				{onClose && (
					<button
						type="button"
						onClick={onClose}
						aria-label={t("navigation.close")}
						className="p-0.5 text-fg-subtle transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
					>
						<X className="h-3.5 w-3.5" aria-hidden="true" />
					</button>
				)}
			</header>

			<div
				className={cn(
					"grid gap-4 px-3 py-3",
					message.direction === "inbound" && "sm:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] sm:gap-6",
				)}
			>
				<section aria-labelledby={messageSectionId}>
					<Eyebrow as="h3" id={messageSectionId} className="text-[10px]">
						{t("message.detailsMessageSection")}
					</Eyebrow>
					<dl className="mt-2 space-y-2">
						<DetailRow
							label={t("message.detailsFrom")}
							warning={senderNameWarning ? t("message.detailsSenderWarning") : null}
						>
							{original.name ? (
								<>
									<span className="font-medium">{original.name}</span>{" "}
									<span className="text-fg-subtle">&lt;{original.address}&gt;</span>
								</>
							) : original.address}
						</DetailRow>
						{showContactName && <DetailRow label={t("message.detailsContact")}>{contactName}</DetailRow>}
						{replyToEntries.length > 0 && (
							<DetailRow
								label={t("message.detailsReplyTo")}
								warning={replyToWarning ? t("message.detailsReplyToWarning") : null}
							>
								{formatRecipientAddressList(message.replyTo, "full")}
							</DetailRow>
						)}
						<DetailRow label={t("source.to")}>{formatRecipientAddressList(message.toAddr, "full") || "—"}</DetailRow>
						{splitEmailAddressList(message.ccAddr).length > 0 && (
							<DetailRow label={t("message.cc")}>{formatRecipientAddressList(message.ccAddr, "full")}</DetailRow>
						)}
						{splitEmailAddressList(message.bccAddr).length > 0 && (
							<DetailRow label={t("message.bcc")}>{formatRecipientAddressList(message.bccAddr, "full")}</DetailRow>
						)}
						<DetailRow label={t("message.date")}>
							{formatUserDate(message.createdAt, { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}
						</DetailRow>
						<DetailRow label={t("source.subject")}>{message.subject?.trim() || t("list.noSubject")}</DetailRow>
					</dl>
				</section>

				{message.direction === "inbound" && (
					<section>
						<Eyebrow as="h3" className="flex items-center gap-1.5 text-[10px]">
							<ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
							{t("message.detailsAuthentication")}
						</Eyebrow>
						{authenticationFailed ? (
							<p className="mt-2 text-fg-subtle">{t("message.detailsAuthenticationError")}</p>
						) : loading ? (
							<p className="mt-2 flex items-center gap-1.5 text-fg-subtle">
								<LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
								{t("message.detailsChecking")}
							</p>
						) : !authentication || !authentication.available ? (
							<p className="mt-2 text-fg-subtle">{t("message.detailsAuthenticationUnavailable")}</p>
						) : (
							<>
								<ul className="mt-2 space-y-1">
									<AuthenticationRow method="SPF" result={authentication.spf} detail={spfDetail} noResult={t("source.noResult")} />
									<AuthenticationRow method="DKIM" result={authentication.dkim} detail={authentication.dkim?.detail ?? null} noResult={t("source.noResult")} />
									<AuthenticationRow method="DMARC" result={authentication.dmarc} detail={authentication.dmarc?.detail ?? null} noResult={t("source.noResult")} />
								</ul>
								{authentication.encryption && (
									<p className="mt-2 text-fg-subtle">
										{t("message.detailsEncryption")} <span className="font-mono text-fg">{authentication.encryption}</span>
									</p>
								)}
								{hasDomainMismatchWarning(authentication) && (
									<p className="mt-2 flex items-start gap-1.5 text-warning-text">
										<ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
										<span>{t("message.detailsDomainMismatch")}</span>
									</p>
								)}
								{(hasPassingCheck || hasFailingCheck) && (
									<div className="mt-3 border-s-2 border-line-strong bg-canvas-subtle px-2.5 py-2">
										<Eyebrow as="h4" className="text-[10px]">
											{t("message.detailsExplanationTitle")}
										</Eyebrow>
										<div className="mt-1 space-y-1 text-[11px] leading-snug text-fg-muted">
											{hasPassingCheck && <p>{t("message.detailsAuthenticationNote")}</p>}
											{hasFailingCheck && <p>{t("message.detailsAuthenticationFailureNote")}</p>}
										</div>
									</div>
								)}
							</>
						)}
					</section>
				)}
			</div>

			<footer className="flex justify-end border-t border-line-subtle px-3 py-2">
				<Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-accent-text hover:text-accent-text" onClick={() => setSourceOpen(true)}>
					<ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
					{t("message.showOriginal")}
				</Button>
			</footer>
			<MessageSourceDialog messageId={message.id} open={sourceOpen} onOpenChange={setSourceOpen} />
		</section>
	);
}
