"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle } from "@/components/icons";
import { authFetch } from "@/lib/auth/client";
import { fetchCurrentUser, useCurrentUser } from "@/hooks/use-current-user";
import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import { peekBootstrapPart, rememberBootstrapPart } from "@/lib/bootstrap/client";
import { canSeeDnsSkippedBanner } from "@/lib/bootstrap/utils";
import type { DnsSkippedDomain } from "@/lib/bootstrap/types";

type SkippedDomain = DnsSkippedDomain & { dnsSkipped?: boolean };

/** A bootstrap answer this recent stands in for `/api/domains` when the banner mounts. */
const SEEDED_MAX_AGE_MS = 5 * 60 * 1000;

async function fetchSkippedDomains(): Promise<SkippedDomain[] | null> {
	try {
		const res = await authFetch("/api/domains", { redirectOnUnauthorized: false });
		if (!res.ok) return null;
		const data = (await res.json()) as { domains?: SkippedDomain[] };
		const skipped = (data.domains ?? []).filter((domain) => domain.dnsSkipped).map(({ id, hostname }) => ({ id, hostname }));
		rememberBootstrapPart("dnsSkippedDomains", skipped);
		return skipped;
	} catch {
		// The banner is advisory; a failed read just hides it.
		return null;
	}
}

/** The bootstrap's list when it has one; otherwise `/api/domains`, but only for accounts that own or manage domains. */
async function loadSkippedDomains(): Promise<SkippedDomain[] | null> {
	const seeded = peekBootstrapPart("dnsSkippedDomains", SEEDED_MAX_AGE_MS);
	if (seeded) return seeded;
	if (!canSeeDnsSkippedBanner(await fetchCurrentUser())) return null;
	return fetchSkippedDomains();
}

export function DnsSkippedBanner() {
	const { t } = useLanguage();
	const user = useCurrentUser();
	const [domains, setDomains] = useState<SkippedDomain[]>([]);
	const [busy, setBusy] = useState(false);

	const applyDomains = useCallback((next: SkippedDomain[] | null) => {
		if (next) setDomains(next);
	}, []);

	const load = useCallback(async () => {
		applyDomains(await fetchSkippedDomains());
	}, [applyDomains]);

	useEffect(() => {
		void loadSkippedDomains().then(applyDomains);
	}, [applyDomains]);

	if (domains.length === 0) return null;
	const canManage = !!user && (user.isPrimaryAdmin || (user.role === "admin" && user.canManageDomains));

	async function markDone() {
		setBusy(true);
		try {
			await Promise.all(
				domains.map((domain) =>
					authFetch(`/api/domains/${domain.id}`, {
						method: "PATCH",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ dnsSkipped: false }),
					}),
				),
			);
		} finally {
			setBusy(false);
			await load();
		}
	}

	return (
		<div role="status" className="mx-2 mb-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
			<AlertTriangle className="h-4 w-4 shrink-0" />
			<p className="min-w-0 flex-1">{t("dnsSkipped.warning", { domains: domains.map((domain) => domain.hostname).join(", ") })}</p>
			{canManage && (
				<>
					<Link href="/domains" className="font-semibold underline underline-offset-2">{t("dnsSkipped.review")}</Link>
					<Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void markDone()}>{t("dnsSkipped.markDone")}</Button>
				</>
			)}
		</div>
	);
}
