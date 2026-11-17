import { useLanguage } from "@/components/language-provider";
import type { SpamScoreDetailsProps } from "./spam-score-details-types";
import { parseSpamSignals } from "./spam-score-details-utils";

export function SpamScoreDetails({ score, verdict, signals, analysisError }: SpamScoreDetailsProps) {
	const { t } = useLanguage();
	if (score == null && !analysisError) return null;
	const parsedSignals = parseSpamSignals(signals);
	return (
		<details className="mb-2 border border-line bg-canvas-subtle px-4 py-3">
			<summary className="cursor-pointer text-sm font-medium text-fg">
				{score == null ? t("message.spam.unavailable") : t("message.spam.score", { score, verdict: verdict ?? t("message.spam.inbox") })}
			</summary>
			{analysisError ? (
				<p className="mt-2 text-sm text-fg-muted">{t("message.spam.failed")}</p>
			) : parsedSignals.length > 0 ? (
				<div className="mt-3 space-y-1.5 text-sm text-fg-muted">
					<p className="font-medium text-fg">{t("message.spam.why")}</p>
					{parsedSignals.map((signal) => (
						<p key={signal.id}><span className={`font-mono tabular-nums ${signal.score > 0 ? "text-danger-text" : "text-success-text"}`}>{signal.score > 0 ? "+" : ""}{signal.score}</span>{" "}{signal.reason}</p>
					))}
				</div>
			) : (
				<p className="mt-2 text-sm text-fg-muted">{t("message.spam.none")}</p>
			)}
		</details>
	);
}
