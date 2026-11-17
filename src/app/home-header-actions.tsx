"use client";

import Link from "next/link";
import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import { getHomeActions } from "./utils";
import { HomeAccountMenu } from "./home-account-menu";
import { useHomeAuth } from "./home-auth";

export function HomeHeaderActions() {
	const { t } = useLanguage();
	const user = useHomeAuth();
	if (user) return <HomeAccountMenu user={user} />;

	return (
		<>
			{/* The hero below carries the filled primary action, so the header steps each action down one level. */}
			{getHomeActions(false).map((action) => (
				<Button key={action.href} variant={action.variant === "default" ? "outline" : "ghost"} asChild>
					<Link href={action.href}>{t(action.labelKey)}</Link>
				</Button>
			))}
		</>
	);
}
