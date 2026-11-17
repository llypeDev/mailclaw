import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import { LanguageProvider } from "@/components/language-provider";
import { DEFAULT_LOCALE, catalogPath, getDirection } from "@/lib/i18n/utils";
import { getRequestLocale, loadServerMessages } from "@/lib/i18n/server";
import { sidebarBootstrapScript } from "@/components/sidebar-state-utils";
import { themeBootstrapScript } from "@/components/theme-utils";
import { getHomeBranding } from "./home-server-utils";
import { DEFAULT_ICON_HREF } from "./home-server-icon-utils";
import "./globals.css";

const geistSans = Geist({
	variable: "--font-geist-sans",
	subsets: ["latin"],
});

const geistMono = Geist_Mono({
	variable: "--font-geist-mono",
	subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
	const { appName, iconHref } = await getHomeBranding();
	return {
		title: appName,
		description: "Multi-tenant email on Cloudflare",
		icons: { icon: iconHref ?? DEFAULT_ICON_HREF, apple: "/icon-192.png" },
		appleWebApp: {
			capable: true,
			title: appName,
			statusBarStyle: "default",
		},
		robots: {
			index: false,
			follow: false,
			noarchive: true,
			nosnippet: true,
			noimageindex: true,
			googleBot: {
				index: false,
				follow: false,
				noarchive: true,
				nosnippet: true,
				noimageindex: true,
			},
		},
	};
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
	const locale = await getRequestLocale();
	// The catalog is loaded here (once per isolate) so the server-rendered HTML is translated, but it is not
	// passed down: LanguageProvider reads it from the catalog store while rendering HTML, and the browser
	// fetches the static `/locales/<code>.json` preloaded below instead of receiving it inside every page.
	const translated = locale !== DEFAULT_LOCALE;
	const catalogReadable = translated && !!(await loadServerMessages(locale));
	const { iconHref, ...branding } = await getHomeBranding();
	return (
		<html lang={locale} dir={getDirection(locale)} data-remote-image-proxy="enabled" suppressHydrationWarning>
			<head>
				<script dangerouslySetInnerHTML={{ __html: sidebarBootstrapScript }} />
				<script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
				<link rel="icon" href={iconHref ?? DEFAULT_ICON_HREF}></link>
				{catalogReadable && <link rel="preload" href={catalogPath(locale)} as="fetch" crossOrigin="anonymous" />}
			</head>
			<body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
				{/* An unreadable catalog renders English on both sides (`{}` falls back per key) rather than translating only in the browser. */}
				<LanguageProvider initialLocale={locale} initialMessages={translated && !catalogReadable ? {} : undefined}><Providers initialBranding={branding}>{children}</Providers></LanguageProvider>
			</body>
		</html>
	);
}
