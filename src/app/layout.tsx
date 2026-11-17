import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import { preload } from "react-dom";
import { Providers } from "@/components/providers";
import { LanguageProvider } from "@/components/language-provider";
import { DEFAULT_LOCALE, catalogPath, getDirection } from "@/lib/i18n/utils";
import { getRequestLocale, loadServerMessages } from "@/lib/i18n/server";
import { sidebarBootstrapScript } from "@/components/sidebar-state-utils";
import { themeBootstrapScript } from "@/components/theme-utils";
import { getHomeBranding } from "./home-server-utils";
import { DEFAULT_ICON_HREF } from "./home-server-icon-utils";
import "./globals.css";

// Orange's three typefaces, self-hosted by next/font (the CSP only allows fonts from this origin).
// Scripts these do not cover (Arabic, Devanagari, Thai, CJK…) fall back to the system font. No preload:
// vinext would preload every subset file, while the browser only fetches the unicode ranges a page uses.
const inter = Inter({
	variable: "--font-inter",
	subsets: ["latin", "latin-ext", "cyrillic", "greek", "vietnamese"],
	preload: false,
});

const spaceGrotesk = Space_Grotesk({
	variable: "--font-space-grotesk",
	subsets: ["latin", "latin-ext", "vietnamese"],
	preload: false,
});

const jetbrainsMono = JetBrains_Mono({
	variable: "--font-jetbrains-mono",
	subsets: ["latin", "latin-ext", "cyrillic"],
	preload: false,
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
	// fetches the static `/locales/<code>.json` preloaded here instead of receiving it inside every page.
	// That holds for English too, so no catalog is part of the page's JavaScript. A catalog the server
	// cannot read renders English on both sides rather than translating only in the browser.
	const catalogLocale = (await loadServerMessages(locale)) ? locale : DEFAULT_LOCALE;
	if (catalogLocale !== locale) await loadServerMessages(catalogLocale);
	// A hint, not a `<link>` element: React's RSC renderer turns a `<link rel="preload">` in a Server
	// Component into this same hint and SSR still renders the element, so the tag came out twice.
	preload(catalogPath(catalogLocale), { as: "fetch", crossOrigin: "anonymous" });
	const { iconHref, ...branding } = await getHomeBranding();
	return (
		<html lang={locale} dir={getDirection(locale)} className={`${inter.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable}`} data-remote-image-proxy="enabled" suppressHydrationWarning>
			<head>
				<script dangerouslySetInnerHTML={{ __html: sidebarBootstrapScript }} />
				<script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
				<link rel="icon" href={iconHref ?? DEFAULT_ICON_HREF}></link>
			</head>
			<body className="antialiased">
				<LanguageProvider initialLocale={locale} catalogLocale={catalogLocale === locale ? undefined : catalogLocale}><Providers initialBranding={branding}>{children}</Providers></LanguageProvider>
			</body>
		</html>
	);
}
