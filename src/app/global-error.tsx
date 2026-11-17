"use client";

import { useEffect } from "react";
import Link from "next/link";
import { applyTheme, readThemePreference, themeBootstrapScript } from "@/components/theme-utils";
import { buttonVariants } from "@/components/ui/button-utils";
import { DEFAULT_LOCALE, createTranslator } from "@/lib/i18n/utils";
import type { RouteErrorProps } from "./error-screen-types";
import { GLOBAL_ERROR_MESSAGES, readErrorDigest } from "./error-screen-utils";
import "./globals.css";

// Replaces the root layout, so none of its providers (language, theme, branding) exist here:
// strings are English, bundled with this page, and the theme is applied by hand.
const t = createTranslator(DEFAULT_LOCALE, GLOBAL_ERROR_MESSAGES);

export default function GlobalError({ error, retry }: RouteErrorProps) {
	const digest = readErrorDigest(error);

	useEffect(() => {
		console.error(error);
		applyTheme(readThemePreference());
	}, [error]);

	function tryAgain() {
		if (retry) {
			retry();
			return;
		}
		// vinext only offers `reset`, which re-renders the same failed root payload; a full reload rebuilds it.
		window.location.reload();
	}

	return (
		<html lang={DEFAULT_LOCALE} suppressHydrationWarning>
			<head>
				<title>{t("errorPage.title")}</title>
				<script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
			</head>
			<body className="antialiased">
				<div role="alert" className="flex min-h-dvh w-full flex-col items-center justify-center bg-canvas px-6 py-16 text-center text-fg">
					<h1 className="font-display text-xl font-bold tracking-tight text-fg">{t("errorPage.title")}</h1>
					<p className="mt-2 max-w-sm text-sm text-fg-muted">{t("errorPage.description")}</p>
					<div className="mt-6 flex flex-wrap items-center justify-center gap-2">
						<button type="button" onClick={tryAgain} className={buttonVariants({ size: "sm" })}>
							{t("errorPage.tryAgain")}
						</button>
						<Link href="/" className={buttonVariants({ variant: "outline", size: "sm" })}>
							{t("errorPage.goHome")}
						</Link>
					</div>
					{digest && <p className="mt-8 font-mono text-xs text-fg-subtle">{t("errorPage.reference", { digest })}</p>}
				</div>
			</body>
		</html>
	);
}
