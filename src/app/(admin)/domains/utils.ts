import type { TranslationKey } from "@/lib/i18n/types";
import { defaultTranslator, type Translator } from "@/lib/i18n/utils";
import { authFetch } from "@/lib/auth/client";
import type { DnsAuthRecord, DnsAuthStatus, DomainPreflightResponse } from "./types";

export const dnsAuthRecords: DnsAuthRecord[] = ["mx", "spf", "dkim", "dmarc"];

export const dnsAuthDescriptions = {
	mx: "dns.mx",
	spf: "dns.spf",
	dkim: "dns.dkim",
	dmarc: "dns.dmarc",
} satisfies Record<DnsAuthRecord, TranslationKey>;

export function getDnsAuthStatusLabel(status: DnsAuthStatus, t: Translator = defaultTranslator): string {
	switch (status) {
		case "ok":
			return t("dns.found");
		case "missing":
			return t("dns.missing");
		default:
			return t("dns.notVerified");
	}
}

export type StatusTone = "success" | "danger" | "warning" | "neutral";

/** The start-edge colour of a status row (`ROW_GRID`) for each tone. */
export const STATUS_ROW_TONE: Record<StatusTone, string> = {
	success: "border-s-success",
	danger: "border-s-danger",
	warning: "border-s-warning",
	neutral: "border-s-line-strong",
};

/** The fill and icon colour of a status row's icon tile for each tone. */
export const STATUS_TILE_TONE: Record<StatusTone, string> = {
	success: "bg-success-subtle text-success-text",
	danger: "bg-danger-subtle text-danger-text",
	warning: "bg-warning-subtle text-warning-text",
	neutral: "bg-canvas-subtle text-fg-subtle",
};

/** The Tag tone for a Resend DNS record status (verified, pending, not_started, failed, temporary_failure). */
export function getResendRecordTone(status: string): "success" | "warning" | "danger" | "neutral" {
	if (status === "verified") return "success";
	if (status === "failed" || status === "temporary_failure") return "danger";
	if (status === "pending") return "warning";
	return "neutral";
}

/** A list of DNS records drawn as Orange's table: a 1px frame, rows on the surface split by 1px rules. */
export const DNS_RECORD_LIST = "divide-y divide-line-subtle border border-line bg-surface text-xs text-fg";

export function getDnsAuthItemClass(status: DnsAuthStatus): string {
	switch (status) {
		case "ok":
			return STATUS_ROW_TONE.success;
		case "missing":
			return STATUS_ROW_TONE.danger;
		default:
			return STATUS_ROW_TONE.neutral;
	}
}

export async function checkDomain(hostname: string): Promise<DomainPreflightResponse> {
	const response = await authFetch("/api/domains/check", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ hostname }),
	});
	const data = (await response.json()) as Omit<DomainPreflightResponse, "ok">;
	return { ok: response.ok, ...data };
}
