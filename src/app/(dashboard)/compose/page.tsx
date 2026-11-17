"use client";

import { PageHeader } from "@orangesys/ui";
import { useLanguage } from "@/components/language-provider";
import { ComposeForm } from "@/components/compose/compose-form";

export default function ComposePage() {
	const { t } = useLanguage();
	return (
		<div className="h-full overflow-auto p-8">
			<PageHeader title={t("compose.pageTitle")} description={t("compose.pageDescription")} />
			<ComposeForm mode="page" />
		</div>
	);
}
