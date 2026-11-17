import { useLanguage } from "@/components/language-provider";
import type { UsageChartProps } from "./types";
import { fillDailyUsage, formatDailyLabel, formatTokenCount } from "./utils";
import { getUserTimeZone } from "@/lib/time/utils";

export function UsageChart({ daily, timeZone = getUserTimeZone() }: UsageChartProps) {
	const { t } = useLanguage();
	const days = daily.length ? daily : fillDailyUsage([], timeZone);
	const maxTokens = Math.max(0, ...days.map((day) => day.inputTokens + day.outputTokens));

	return <section className="border border-line bg-surface p-5">
		<div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-display text-base font-semibold text-fg">{t("aiUsage.byDay")}</h2><p className="mt-1 text-xs text-fg-subtle">{t("aiUsage.chartHint", { zone: timeZone })}</p></div><div className="flex items-center gap-4 text-xs text-fg-muted"><span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 bg-[var(--or-color-viz-1)]" /> {t("aiUsage.legendInput")}</span><span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 bg-[var(--or-color-viz-2)]" /> {t("aiUsage.legendOutput")}</span></div></div>
		<div className="mt-5 flex gap-3" role="img" aria-label={t("aiUsage.chartLabel")}>
			<div className="flex h-48 flex-col justify-between pb-5 text-end font-mono text-[10px] tabular-nums text-fg-subtle"><span>{formatTokenCount(maxTokens)}</span><span>0</span></div>
			<div className="flex min-w-0 flex-1 items-end gap-1 border-b border-line-strong">
				{days.map((day, index) => {
					const total = day.inputTokens + day.outputTokens;
					return <div key={day.date} className="flex h-48 min-w-0 flex-1 flex-col items-center" title={t("aiUsage.barTitle", { day: formatDailyLabel(day.date), tokens: formatTokenCount(total), requests: formatTokenCount(day.requests) })}>
						<div className="flex h-[172px] w-full items-end justify-center"><div className="relative w-full max-w-5" style={{ height: `${total ? Math.max(2, total / maxTokens * 100) : 0}%` }}><div className="absolute inset-x-0 bottom-0 bg-[var(--or-color-viz-1)]" style={{ height: `${total ? day.inputTokens / total * 100 : 0}%` }} /><div className="absolute inset-x-0 top-0 bg-[var(--or-color-viz-2)]" style={{ height: `${total ? day.outputTokens / total * 100 : 0}%` }} /></div></div>
						<span className="h-5 whitespace-nowrap pt-1 font-mono text-[9px] text-fg-subtle">{index % 5 === 0 || index === days.length - 1 ? formatDailyLabel(day.date) : ""}</span>
					</div>;
				})}
			</div>
		</div>
	</section>;
}
