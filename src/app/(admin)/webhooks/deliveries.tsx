"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Tag } from "@orangesys/ui";
import type { TagTone } from "@orangesys/ui";
import { RotateCw } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import type { WebhookDelivery } from "./types";
import {
	DELIVERY_STATUS_LABELS,
	fetchDeliveries,
	formatDuration,
	formatTimestamp,
	isRetryable,
	retryDelivery,
} from "./utils";

const STATUS_TONES: Record<WebhookDelivery["status"], TagTone> = {
	delivered: "success",
	failed: "danger",
	exhausted: "danger",
	retrying: "warning",
	pending: "neutral",
};

export function WebhookDeliveries({ webhookId }: { webhookId: string }) {
	const { t } = useLanguage();
	const qc = useQueryClient();
	const deliveries = useQuery({
		queryKey: ["webhook-deliveries", webhookId],
		queryFn: () => fetchDeliveries(webhookId),
		// Retries land asynchronously from the queue, so keep the table fresh while it is open.
		refetchInterval: 15_000,
	});

	const retry = useMutation({
		mutationFn: (deliveryId: string) => retryDelivery(webhookId, deliveryId),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["webhook-deliveries", webhookId] });
			qc.invalidateQueries({ queryKey: ["webhooks"] });
		},
	});

	if (deliveries.isLoading) {
		return <p className="text-sm text-fg-subtle">{t("webhooks.loadingDeliveries")}</p>;
	}

	if (!deliveries.data?.length) {
		return <p className="text-sm text-fg-subtle">{t("webhooks.noDeliveries")}</p>;
	}

	return (
		<div role="region" tabIndex={0} aria-label={t("webhooks.stat.deliveries")} className="overflow-x-auto border border-line bg-surface">
			<table className="w-full min-w-[820px] text-start text-sm">
				<thead className="border-b border-line-strong bg-canvas-subtle font-display text-[length:var(--or-text-2xs)] font-medium uppercase tracking-[var(--or-tracking-meta)] text-fg-subtle">
					<tr>
						<th scope="col" className="px-3 py-2 text-start font-medium">{t("webhooks.col.event")}</th>
						<th scope="col" className="px-3 py-2 text-start font-medium">{t("webhooks.col.status")}</th>
						<th scope="col" className="px-3 py-2 text-start font-medium">{t("webhooks.col.attempts")}</th>
						<th scope="col" className="px-3 py-2 text-start font-medium">{t("webhooks.col.response")}</th>
						<th scope="col" className="px-3 py-2 text-start font-medium">{t("webhooks.col.lastAttempt")}</th>
						<th scope="col" className="px-3 py-2 text-start font-medium">{t("webhooks.col.nextRetry")}</th>
						<th scope="col" className="px-3 py-2 text-start font-medium" />
					</tr>
				</thead>
				<tbody>
					{deliveries.data.map((delivery) => (
						<tr key={delivery.id} className="border-t border-line align-top first:border-t-0">
							<td className="px-3 py-2">
								<span className="block">{delivery.eventType}</span>
								<span className="block text-xs text-fg-subtle">
									{formatTimestamp(delivery.createdAt)}
								</span>
							</td>
							<td className="px-3 py-2">
								<Tag size="sm" tone={STATUS_TONES[delivery.status] ?? "neutral"}>
									{DELIVERY_STATUS_LABELS[delivery.status] ? t(DELIVERY_STATUS_LABELS[delivery.status]) : delivery.status}
								</Tag>
							</td>
							<td className="px-3 py-2 whitespace-nowrap tabular-nums">
								{/* Manual retries can push attempts past the configured max, so never show "3 / 2". */}
								{delivery.attempts} / {Math.max(delivery.maxAttempts, delivery.attempts)}
							</td>
							<td className="px-3 py-2">
								<span className="block whitespace-nowrap">
									{delivery.responseStatus ?? "—"}
									{delivery.durationMs !== null && (
										// An explicit separator: "200" next to "6ms" otherwise reads as "2006ms".
										<span className="ms-1 text-xs text-fg-subtle">
											· {formatDuration(delivery.durationMs)}
										</span>
									)}
								</span>
								{delivery.error && (
									<span className="mt-1 block max-w-xs truncate text-xs text-danger-text" title={delivery.error}>
										{delivery.error}
									</span>
								)}
							</td>
							<td className="px-3 py-2 whitespace-nowrap text-fg-muted">
								{formatTimestamp(delivery.lastAttemptAt)}
							</td>
							<td className="px-3 py-2 whitespace-nowrap text-fg-muted">
								{formatTimestamp(delivery.nextRetryAt)}
							</td>
							<td className="px-3 py-2">
								{isRetryable(delivery) && (
									<Button
										variant="outline"
										size="sm"
										disabled={retry.isPending}
										onClick={() => retry.mutate(delivery.id)}
									>
										<RotateCw className="h-3 w-3" /> {t("webhooks.retry")}
									</Button>
								)}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
