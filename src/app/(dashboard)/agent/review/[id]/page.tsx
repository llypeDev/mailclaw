"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Alert, PageHeader } from "@orangesys/ui";
import { useLanguage } from "@/components/language-provider";
import { authFetch } from "@/lib/auth/client";
import { SendReview } from "@/components/agent/send-review";
import type { AgentReviewResponse } from "@/components/agent/send-review-types";

export default function AgentReviewPage() {
	const { t } = useLanguage();
	const { id } = useParams<{ id: string }>();
	const router = useRouter();
	const [request, setRequest] = useState<AgentReviewResponse | null>(null);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		void authFetch(`/api/agent/approvals/${id}`).then(async (response) => {
			const data = await response.json() as AgentReviewResponse;
			if (!response.ok) throw new Error(data.error || t("agent.review.loadFailed"));
			setRequest(data);
		}).catch((cause) => setError(cause instanceof Error ? cause.message : t("agent.review.loadFailed")));
	}, [id, t]);
	return <div className="p-8">
		<PageHeader title={t("agent.review.title")} />
		{error && <Alert live tone="danger" className="mt-4">{error}</Alert>}
		{!error && !request && <p className="mt-4 text-fg-muted">{t("agent.review.loading")}</p>}
		{request && (request.status !== "pending" || request.stale || !request.snapshot) && <p className="mt-4 text-fg">{request.stale ? t("agent.review.stale") : t("agent.review.status", { status: request.status })}</p>}
		{request?.status === "pending" && !request.stale && request.snapshot && <SendReview approvalId={id} snapshot={request.snapshot} unfamiliarRecipients={request.unfamiliarRecipients} onClose={() => router.push("/drafts")} onSent={() => router.push("/sent")} />}
	</div>;
}
