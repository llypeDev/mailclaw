"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Stat, StatGroup } from "@orangesys/ui";
import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import type { AiUsageResponse } from "./types";
import { fetchAiUsage, formatEstimatedUsd, formatTokenCount, formatUsageDate, formatUsageProvider } from "./utils";
import { UsageChart } from "./usage-chart";

export default function AiUsagePage() {
	const { t } = useLanguage();
	const [data, setData] = useState<AiUsageResponse | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loadingPage, setLoadingPage] = useState(false);

	useEffect(() => {
		let active = true;
		void fetchAiUsage(1).then((result) => { if (active) setData(result); }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : t("aiUsage.loadFailed")); });
		return () => { active = false; };
	}, [t]);

	const totals = data?.totals;
	return <div className="space-y-6">
		<div className="flex items-start justify-between gap-4"><div><h1 className="font-display text-2xl font-semibold tracking-[-0.02em] text-fg md:text-3xl">{t("aiUsage.title")}</h1><p className="mt-2 text-sm text-fg-muted">{t("aiUsage.description")}</p></div><Link href="/agent" className="shrink-0 text-sm font-medium text-accent-text underline-offset-4 hover:underline">{t("aiUsage.back")}</Link></div>
		{error && <p role="alert" className="text-sm text-danger-text">{error}</p>}
		<StatGroup columns={3} className="bg-surface">
			<Stat label={t("aiUsage.totalTokens")} value={totals ? formatTokenCount(totals.totalTokens) : "—"} />
			<Stat label={t("aiUsage.totalRequests")} value={totals ? formatTokenCount(totals.requests) : "—"} />
			<Stat label={t("aiUsage.spend")} value={totals && totals.pricedRequests ? formatEstimatedUsd(totals.costUsdMicros) : "—"} help={totals && totals.pricedRequests < totals.requests ? t("aiUsage.noRate", { count: formatTokenCount(totals.requests - totals.pricedRequests) }) : undefined} />
		</StatGroup>
		<UsageChart daily={data?.daily ?? []} timeZone={data?.timeZone} />
		<section role="region" tabIndex={0} aria-label={t("aiUsage.title")} className="overflow-x-auto border border-line bg-surface" aria-busy={loadingPage}><table className="w-full min-w-[720px] text-start text-sm"><thead className="border-b border-line-strong bg-canvas-subtle font-display text-[length:var(--or-text-2xs)] font-medium uppercase tracking-[var(--or-tracking-meta)] text-fg-subtle"><tr><th scope="col" className="px-4 py-3 text-start font-medium">{t("aiUsage.col.dateTime")}</th><th scope="col" className="px-4 py-3 text-start font-medium">{t("aiUsage.col.model")}</th><th scope="col" className="px-4 py-3 text-start font-medium">{t("aiUsage.col.provider")}</th><th scope="col" className="px-4 py-3 text-end font-medium">{t("aiUsage.col.input")}</th><th scope="col" className="px-4 py-3 text-end font-medium">{t("aiUsage.col.output")}</th><th scope="col" className="px-4 py-3 text-end font-medium">{t("aiUsage.col.spending")}</th></tr></thead><tbody className="divide-y divide-line">{data?.rows.map((row) => <tr key={row.id} className="transition-colors hover:bg-surface-hover"><td className="whitespace-nowrap px-4 py-3 text-fg-muted">{formatUsageDate(row.createdAt)}</td><td className="max-w-56 break-all px-4 py-3 font-mono text-xs">{row.model}</td><td className="px-4 py-3">{formatUsageProvider(row.provider)}</td><td className="px-4 py-3 text-end tabular-nums">{formatTokenCount(row.inputTokens)}</td><td className="px-4 py-3 text-end tabular-nums">{formatTokenCount(row.outputTokens)}</td><td className="px-4 py-3 text-end tabular-nums">{formatEstimatedUsd(row.costUsdMicros)}</td></tr>)}{data && data.rows.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-fg-subtle">{t("aiUsage.none")}</td></tr>}{!data && !error && <tr><td colSpan={6} className="px-4 py-8 text-center text-fg-subtle">{t("aiUsage.loading")}</td></tr>}</tbody></table></section>
		{data && <div className="flex items-center justify-end gap-3 text-sm text-fg-muted"><span className="tabular-nums">{t("aiUsage.pageOf", { page: data.page, total: data.totalPages, size: data.pageSize })}</span><Button type="button" variant="outline" size="sm" disabled={loadingPage || data.page <= 1} onClick={() => { setLoadingPage(true); setError(null); void fetchAiUsage(data.page - 1).then(setData).catch((cause) => setError(cause instanceof Error ? cause.message : t("aiUsage.pageFailed"))).finally(() => setLoadingPage(false)); }}>{t("aiUsage.previous")}</Button><Button type="button" variant="outline" size="sm" disabled={loadingPage || data.page >= data.totalPages} onClick={() => { setLoadingPage(true); setError(null); void fetchAiUsage(data.page + 1).then(setData).catch((cause) => setError(cause instanceof Error ? cause.message : t("aiUsage.pageFailed"))).finally(() => setLoadingPage(false)); }}>{t("aiUsage.next")}</Button></div>}
		<p className="text-xs text-fg-subtle">{t("aiUsage.note")}</p>
	</div>;
}
