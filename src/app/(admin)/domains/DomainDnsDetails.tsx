import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import { dnsAuthDescriptions, getDnsAuthItemClass } from "./utils";
import { ROW_GRID, StatusBadge, StatusRow } from "./status-row";
import CloudflareReceivingConfig from "./CloudflareReceivingConfig";
import ReceivingSetupSection from "./ReceivingSetupSection";
import SendingSetupSection from "./SendingSetupSection";
import TrackingHostSection from "./TrackingHostSection";
import type { DnsAuthRecord, DomainDnsDetailsProps } from "./types";

export default function DomainDnsDetails({
	domain,
	dns,
	onSetup,
	setupRecord,
	setupMessage,
	onSendingProviderChange,
	sendingProviderBusy,
	sendingProviderMessage,
	onReceivingProviderChange,
	receivingProviderBusy,
	receivingProviderMessage,
	onDnsChanged,
}: DomainDnsDetailsProps) {
	const { t } = useLanguage();
	const audit = dns.audit;
	const manual = domain.zoneId === "manual" && !domain.dnsSkipped;
	const subdomain = dns.sendingSubdomain;
	const sendingOk = subdomain ? dns.sendingEnabled : manual && domain.sendingEnabled;
	const sendingLabel = subdomain
		? t("domains.sendingFor", { name: subdomain.name, state: dns.sendingEnabled ? t("domains.enabled") : t("domains.disabled") })
		: manual
			? domain.sendingEnabled
				? t("domains.sendingConfigured")
				: t("domains.sendingNotConfigured")
			: t("domains.sendingNotSet");
	const routingOk = dns.routing.missing.length === 0 && (dns.routing.records.length > 0 || domain.routingEnabled);
	const routingLabel = routingOk
		? t("domains.routingConfigured")
		: dns.routing.missing.length > 0
			? t("domains.recordsMissing", { count: dns.routing.missing.length })
			: t("domains.noRoutingRecords");

	const auditRow = (record: DnsAuthRecord) => {
		if (!audit) return null;
		const item = audit[record];
		const ok = item.status === "ok";
		return (
			<li key={record} className={`${ROW_GRID} ${getDnsAuthItemClass(item.status)}`}>
				<StatusBadge ok={ok} tone={item.status === "missing" ? "red" : "neutral"} />
				<span className="min-w-0">
					<span className="block font-display font-medium text-fg">{t("domains.recordLabel", { label: item.label })}</span>
					<span className="block text-xs text-fg-muted">{t(dnsAuthDescriptions[record])}</span>
				</span>
				{ok ? (
					<span className="min-w-0 break-all font-mono text-xs leading-5 text-fg-muted">{item.found.length > 0 ? item.found.join(", ") : item.name}</span>
				) : (
					<Button
						variant="outline"
						size="sm"
						className="w-fit sm:col-start-4"
						disabled={manual || setupRecord === record}
						title={manual ? t("domains.manualDns") : t("domains.createRecord", { label: item.label })}
						onClick={() => onSetup?.(record)}
					>
						{setupRecord === record ? t("domains.settingUp") : t("domains.setup")}
					</Button>
				)}
			</li>
		);
	};

	const cloudflareConfig = (
		<ul className="space-y-2">
			<StatusRow ok={!!sendingOk} title={t("domains.emailSending")} hint={t("domains.emailSendingHint")}>{sendingLabel}</StatusRow>
			{auditRow("dkim")}
		</ul>
	);

	const cloudflareReceiving = (
		<CloudflareReceivingConfig domainId={domain.id} routingOk={routingOk} routingLabel={routingLabel} manual={manual} onChanged={onDnsChanged} />
	);

	return (
		<div className="space-y-8 border-t border-line pt-5">
			{audit && (
				<section>
					<h2 className="font-display text-base font-semibold text-fg">{t("domains.setupTitle")}</h2>
					<p className="mt-0.5 text-sm text-fg-muted">
						{t("domains.setupDescription")}
					</p>
					<ul className="mt-3 space-y-2">
						{(["mx", "spf", "dmarc"] as DnsAuthRecord[]).map(auditRow)}
					</ul>
					{manual && (
						<p className="mt-2 text-xs text-fg-muted">
							{t("domains.manualDnsNote")}
						</p>
					)}
					{setupMessage && <p role="alert" className="mt-2 text-xs text-danger-text">{setupMessage}</p>}
				</section>
			)}
			<ReceivingSetupSection
				domain={domain}
				onChange={onReceivingProviderChange}
				busy={receivingProviderBusy}
				message={receivingProviderMessage}
				cloudflareConfig={cloudflareReceiving}
				cloudflareOk={routingOk}
			/>
			<SendingSetupSection
				domain={domain}
				onChange={onSendingProviderChange}
				busy={sendingProviderBusy}
				message={sendingProviderMessage}
				cloudflareConfig={cloudflareConfig}
				cloudflareOk={!!sendingOk && audit?.dkim.status === "ok"}
			/>
			{domain.sendingProvider !== "none" && <TrackingHostSection domain={domain} />}
		</div>
	);
}
