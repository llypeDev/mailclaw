"use client";

import { startTransition, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, RotateCw } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ErrorScreenProps, RouteErrorProps } from "./error-screen-types";
import { readErrorDigest } from "./error-screen-utils";

export function ErrorScreen({ icon, title, description, digest, fullPage, children }: ErrorScreenProps) {
	const { t } = useLanguage();
	return (
		<div
			role="alert"
			className={cn(
				"flex w-full flex-col items-center justify-center px-6 py-16 text-center",
				fullPage ? "min-h-dvh bg-white" : "h-full min-h-[50vh]",
			)}
		>
			<div className="mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-neutral-100 text-neutral-500">{icon}</div>
			<h1 className="text-xl font-semibold text-neutral-900">{title}</h1>
			<p className="mt-2 max-w-sm text-sm text-neutral-500">{description}</p>
			{children && <div className="mt-6 flex flex-wrap items-center justify-center gap-2">{children}</div>}
			{digest && <p className="mt-8 font-mono text-xs text-neutral-400">{t("errorPage.reference", { digest })}</p>}
		</div>
	);
}

/**
 * Body of every `error.tsx`. vinext's boundary only offers `reset`, which re-renders without refetching,
 * so the server components are refreshed first; Next's `retry` does both.
 */
export function RouteErrorFallback({ error, retry, reset, fullPage }: RouteErrorProps & { fullPage?: boolean }) {
	const { t } = useLanguage();
	const router = useRouter();

	useEffect(() => {
		console.error(error);
	}, [error]);

	function tryAgain() {
		if (retry) {
			retry();
			return;
		}
		startTransition(() => {
			router.refresh();
			reset?.();
		});
	}

	return (
		<ErrorScreen
			icon={<AlertTriangle className="h-6 w-6" />}
			title={t("errorPage.title")}
			description={t("errorPage.description")}
			digest={readErrorDigest(error)}
			fullPage={fullPage}
		>
			<Button type="button" size="sm" onClick={tryAgain}>
				<RotateCw className="h-3.5 w-3.5" />
				{t("errorPage.tryAgain")}
			</Button>
			<Button asChild variant="outline" size="sm">
				<Link href="/">{t("errorPage.goHome")}</Link>
			</Button>
		</ErrorScreen>
	);
}
