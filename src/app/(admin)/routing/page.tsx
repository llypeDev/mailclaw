"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLanguage } from "@/components/language-provider";
import { DomainRouting } from "@/components/settings/domain-routing/domain-routing";
import { RoutingRuleSelect } from "@/components/settings/domain-routing/routing-rule-select";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchAdminRoutingDomains } from "./utils";

export default function RoutingPage() {
	const { t } = useLanguage();
	const [domainId, setDomainId] = useState("");
	const domains = useQuery({
		queryKey: ["admin-routing-domains"],
		queryFn: fetchAdminRoutingDomains,
	});
	const availableDomains = domains.data?.domains ?? [];
	const selectedDomain = availableDomains.find((domain) => domain.id === domainId) ?? availableDomains[0];

	return (
		<div className="space-y-8">
			<div>
				<h1 className="font-display text-2xl font-semibold tracking-[-0.02em] text-fg md:text-3xl">{t("routingAdmin.title")}</h1>
				<p className="mt-2 text-sm text-fg-muted">
					{t("routingAdmin.description")}
				</p>
			</div>

			<section className="space-y-4">
				<div>
					<h2 className="font-display text-xl font-semibold text-fg">{t("routingAdmin.domain")}</h2>
					<p className="mt-1 text-sm text-fg-muted">{t("routingAdmin.chooseDomain")}</p>
				</div>
				<div className="border border-line bg-surface p-6">
					{domains.isLoading ? (
						<Skeleton className="h-10 w-full" />
					) : domains.isError ? (
						<p role="alert" className="text-sm text-danger-text">{domains.error.message}</p>
					) : availableDomains.length === 0 ? (
						<p className="text-sm text-fg-muted">{t("routingAdmin.addDomainFirst")}</p>
					) : (
						<div className="grid gap-2">
							<Label htmlFor="routing-domain">{t("routingAdmin.managedDomain")}</Label>
							<RoutingRuleSelect
								id="routing-domain"
								value={selectedDomain?.id ?? ""}
								onChange={(event) => setDomainId(event.target.value)}
							>
								{availableDomains.map((domain) => (
									<option key={domain.id} value={domain.id}>
										{domain.hostname}
									</option>
								))}
							</RoutingRuleSelect>
						</div>
					)}
				</div>
			</section>

			{selectedDomain && <DomainRouting key={selectedDomain.id} domain={selectedDomain} />}
		</div>
	);
}
