"use client";

import { useEffect, useState } from "react";
import { Tag } from "@orangesys/ui";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/components/language-provider";
import { authFetch } from "@/lib/auth/client";
import type { ResendDomainView } from "@/lib/domains/resend-domain-types";
import ResendKeyRow from "./ResendKeyRow";
import { StatusRow } from "./status-row";
import { DNS_RECORD_LIST, getResendRecordTone } from "./utils";

type ResendResponse = { keyConfigured?: boolean; canManageDomains?: boolean; resend?: ResendDomainView | null; error?: string };

async function postJson<T>(url: string, method: string, body: unknown): Promise<T> {
	const response = await authFetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
	const data = (await response.json()) as T & { error?: string };
	if (!response.ok) throw new Error(data.error ?? "Request failed");
	return data;
}

export default function ResendDomainSection({ domainId, onStatus }: { domainId: string; onStatus?: (status: string | null) => void }) {
	const { t } = useLanguage();
	const [keyConfigured, setKeyConfigured] = useState<boolean | null>(null);
	const [view, setView] = useState<ResendDomainView | null>(null);
	const [canManage, setCanManage] = useState(true);
	const [loading, setLoading] = useState(true);
	const [reload, setReload] = useState(0);
	const [busy, setBusy] = useState<"setup" | "verify" | "test" | null>(null);
	const [error, setError] = useState("");
	const [notice, setNotice] = useState("");

	useEffect(() => {
		let active = true;
		authFetch(`/api/domains/${domainId}/resend`, { cache: "no-store" })
			.then(async (response) => ({ response, data: (await response.json()) as ResendResponse }))
			.then(({ response, data }) => {
				if (!active) return;
				if (!response.ok && data.keyConfigured === undefined) throw new Error(data.error ?? t("resend.unreachable"));
				setKeyConfigured(data.keyConfigured ?? true);
				setCanManage(data.canManageDomains ?? true);
				setView(data.resend ?? null);
				setError(response.ok ? "" : data.error ?? "");
			})
			.catch((err) => { if (active) { setKeyConfigured(true); setError(err instanceof Error ? err.message : t("resend.unreachable")); } })
			.finally(() => { if (active) setLoading(false); });
		return () => { active = false; };
	}, [domainId, reload, t]);

	useEffect(() => {
		if (loading) return;
		onStatus?.(keyConfigured === false ? "no_key" : canManage ? (view?.status ?? null) : null);
	}, [loading, keyConfigured, canManage, view, onStatus]);

	async function run(kind: "setup" | "verify" | "test", action: () => Promise<void>) {
		setBusy(kind);
		setError("");
		setNotice("");
		try { await action(); }
		catch (err) { setError(err instanceof Error ? err.message : t("domains.requestFailed")); }
		finally { setBusy(null); }
	}

	const domainAction = (action: "setup" | "verify") => run(action, async () => {
		const data = await postJson<ResendResponse>(`/api/domains/${domainId}/resend`, "POST", { action });
		setView(data.resend ?? null);
	});
	const sendTest = () => run("test", async () => {
		const data = await postJson<{ to: string }>(`/api/domains/${domainId}/resend`, "POST", { action: "test" });
		setNotice(t("resend.testSent", { to: data.to }));
	});

	const verified = view?.status === "verified";
	const needsFullKey = t("resend.needsFullKey");
	const domainLabel = loading
		? t("resend.checking")
		: !canManage
			? t("resend.cannotCheck")
			: !view
				? t("resend.cannotRead")
				: verified
					? t("resend.verified")
					: view.registered
						? view.missingDns === 0
							? t("resend.waiting", { status: view.status.replace(/_/g, " ") })
							: view.missingDns
								? t("resend.missingDns", { count: view.missingDns })
								: t("resend.dnsCheck", { status: view.status.replace(/_/g, " ") })
						: t("resend.notAdded");
	const domainButton = !canManage
		? t("resend.btn.setupDomain")
		: !view
			? null
			: view.registered && !view.dnsManaged
				? t("resend.btn.verify")
				: !view.registered
					? view.dnsManaged ? t("resend.btn.setupDomainDns") : t("resend.btn.setupDomain")
					: view.dnsManaged && view.missingDns !== 0
						? t("resend.btn.createMissing")
						: t("resend.btn.checkStatus");

	return (
		<div className="space-y-2">
			<ul className="space-y-2">
				<ResendKeyRow
					configured={keyConfigured}
					onChanged={(configured) => { setKeyConfigured(configured); if (!configured) setView(null); setLoading(true); setReload((value) => value + 1); }}
					onError={setError}
				/>

				{keyConfigured && (
					<StatusRow
						ok={verified}
						title={t("resend.domain")}
						hint={t("resend.domainHint")}
						action={verified ? (
							<Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void sendTest()}>{busy === "test" ? t("resend.sending") : t("resend.sendTest")}</Button>
						) : domainButton && !loading ? (
							<Button
								size="sm"
								variant="outline"
								disabled={!canManage || busy !== null}
								title={canManage ? undefined : needsFullKey}
								onClick={() => void domainAction(view?.registered && (!view.dnsManaged || view.missingDns === 0) ? "verify" : "setup")}
							>
								{busy === "verify" ? t("domains.checking") : busy === "setup" ? t("domains.working") : domainButton}
							</Button>
						) : undefined}
					>
						{domainLabel}
					</StatusRow>
				)}
			</ul>

			{!loading && !canManage && keyConfigured && <p className="text-xs text-fg-muted">{t("resend.manualHint")}</p>}
			{view && view.registered && !verified && !view.dnsManaged && <p className="text-xs text-fg-muted">{t("resend.addRecords")}</p>}
			{view && view.registered && !verified && view.dnsManaged && view.missingDns === 0 && <p className="text-xs text-fg-muted">{t("resend.propagate")}</p>}

			{view && view.records.length > 0 && !verified && (
				<ul className={DNS_RECORD_LIST}>
					{view.records.map((record) => (
						<li key={`${record.type}-${record.name}-${record.value}`} className="grid gap-1 px-3 py-2 sm:grid-cols-[4rem_minmax(8rem,14rem)_minmax(0,1fr)_auto] sm:items-center sm:gap-3">
							<span className="font-mono font-semibold">{record.type}</span>
							<span className="break-all font-mono">{record.name}</span>
							<span className="break-all font-mono text-fg-muted">{record.priority !== null ? `${record.priority} ` : ""}{record.value}</span>
							<span><Tag size="sm" tone={getResendRecordTone(record.status)}>{record.status.replace(/_/g, " ")}</Tag></span>
						</li>
					))}
				</ul>
			)}
			{notice && <p role="status" className="text-xs text-success-text">{notice}</p>}
			{error && <p role="alert" className="text-xs text-danger-text">{error}</p>}
		</div>
	);
}
