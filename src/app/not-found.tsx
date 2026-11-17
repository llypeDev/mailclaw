"use client";

import Link from "next/link";
import { Search } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import { ErrorScreen } from "./error-screen";

export default function NotFound() {
	const { t } = useLanguage();
	return (
		<ErrorScreen icon={<Search className="h-6 w-6" />} title={t("notFound.title")} description={t("notFound.description")} fullPage>
			<Button asChild size="sm">
				<Link href="/">{t("errorPage.goHome")}</Link>
			</Button>
		</ErrorScreen>
	);
}
