import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { heroMessages, sidebarItems } from "./utils";
import { Inbox, Mail, Search, ShieldCheck } from "@/components/icons";
import { getServerTranslator } from "@/lib/i18n/server";
import { getCurrentUser } from "@/lib/auth/cookies";
import { getEnv } from "@/lib/cloudflare";
import { LanguageSelector } from "@/components/language-selector";
import { getHomeBranding } from "./home-server-utils";
import { HomeAuthProvider } from "./home-auth";
import { HomeHeaderActions } from "./home-header-actions";
import { HomeHeroActions } from "./home-hero-actions";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const branding = await getHomeBranding();
  return {
    title: branding.appName,
    icons: { icon: branding.hasCustomIcon ? "/api/branding/icon" : "/icon-96.png" },
  };
}

export default async function HomePage() {
  const [branding, t, sessionUser] = await Promise.all([
    getHomeBranding(),
    getServerTranslator(),
    // A session lookup failure must not take down the public landing page.
    getCurrentUser(getEnv()).catch(() => null),
  ]);
  // Signed-in users skip the landing page; the inbox restores their last-used mailbox.
  if (sessionUser && !sessionUser.disabled) redirect("/inbox");

  // Render the signed-in account from the server response so the header does not
  // wait for hydration and an /api/auth/me round trip before showing it.
  const initialUser = sessionUser
    ? {
        id: sessionUser.id,
        email: sessionUser.email,
        name: sessionUser.name,
        role: sessionUser.role,
        hasAvatar: !!sessionUser.avatarKey,
        calendarEnabled: sessionUser.calendarEnabled,
        driveEnabled: sessionUser.driveEnabled,
      }
    : null;

  return (
    <HomeAuthProvider initialUser={initialUser}>
    <div className="min-h-dvh bg-canvas text-fg">
      <header className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between border-b border-line-subtle px-4 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="flex items-center gap-3"
          aria-label={t("home.homeLabel", { app: branding.appName })}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- branding icon (API route or small static PNG) at a fixed size */}
          <img src={branding.hasCustomIcon ? "/api/branding/icon" : "/icon-96.png"} height={32} width={32} alt="" />
          <span className="hidden font-display text-lg font-bold tracking-tight sm:inline">
            {branding.appName}
          </span>
        </Link>

        {/* <nav className="hidden items-center gap-6 text-sm font-medium text-fg-muted md:flex">
					{landingNavItems.map((item) => (
						<a key={item.href} href={item.href} className="transition-colors hover:text-fg">
							{item.label}
						</a>
					))}
				</nav> */}

        <div className="flex items-center gap-2">
          <div className="hidden sm:block">
            <LanguageSelector variant="text" />
          </div>
          <HomeHeaderActions />
        </div>
      </header>

      <main>
        <section className="mx-auto grid max-w-7xl grid-cols-1 gap-10 px-4 pb-12 pt-8 sm:px-6 md:pt-16 lg:grid-cols-[0.86fr_1.14fr] lg:px-8">
          <div className="flex max-w-2xl flex-col justify-center">
            {/* An eyebrow in the Orange style: square accent marker, uppercase display type. */}
            <p className="mb-6 flex w-fit items-center gap-2 font-display text-xs font-medium uppercase tracking-[0.14em] text-accent-text">
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              {t("home.badge")}
            </p>
            {/* Right-to-left scripts (Arabic, Persian, Urdu) need room above and below the line, so they get a taller leading. */}
            <h1 className="max-w-[12ch] font-display text-5xl font-semibold leading-[0.96] tracking-tight text-fg sm:text-6xl lg:text-7xl rtl:leading-tight">
              {t("home.headline")}
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-fg-muted">
              {t("home.subheadline")}
            </p>
            <HomeHeroActions />
          </div>

          {/* A static picture of the app, drawn with the same tokens as the real shell. */}
          <div className="relative min-h-[360px] overflow-hidden border border-line bg-canvas-subtle bg-[linear-gradient(var(--or-color-grid-line)_1px,transparent_1px),linear-gradient(90deg,var(--or-color-grid-line)_1px,transparent_1px)] bg-[size:48px_48px] bg-[position:-1px_-1px] sm:min-h-[520px]">
            <div className="grid h-full min-h-[360px] grid-cols-[176px_1fr] sm:min-h-[520px]">
              <aside className="hidden flex-col gap-px border-e border-line-subtle bg-canvas py-5 pe-3 sm:flex">
                <div className="mb-4 flex items-center gap-3 px-4 text-fg">
                  <Inbox className="h-5 w-5" />
                  <span className="font-display font-bold">{t("home.mockMail")}</span>
                </div>
                <div className="mb-3 ms-3 flex h-12 w-fit items-center gap-2 bg-accent px-5 font-display text-sm font-semibold text-on-accent">
                  <Mail className="h-4 w-4" />
                  {t("navigation.compose")}
                </div>
                {sidebarItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <div
                      key={item.labelKey}
                      className={`relative flex h-9 items-center justify-between ps-4 pe-3 text-sm font-medium ${
                        item.active
                          ? "bg-accent-subtle font-semibold text-accent-text before:absolute before:inset-y-0 before:start-0 before:w-0.5 before:bg-accent"
                          : "text-fg-muted"
                      }`}
                    >
                      <span className="flex items-center gap-3">
                        <Icon className="h-4 w-4" />
                        {t(item.labelKey)}
                      </span>
                      {item.count && (
                        <span className="text-xs tabular-nums">
                          {item.count}
                        </span>
                      )}
                    </div>
                  );
                })}
              </aside>

              <div className="col-span-2 flex min-w-0 flex-col sm:col-span-1">
                <div className="flex h-16 items-center gap-3 bg-canvas px-4">
                  <div className="flex h-11 flex-1 items-center gap-3 border border-line-control bg-surface px-4 text-fg-subtle">
                    <Search className="h-5 w-5" />
                    <span className="text-[15px]">{t("search.mail")}</span>
                  </div>
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-inverse text-fg-inverse">
                    <Mail className="h-4 w-4" />
                  </div>
                </div>

                <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-t border-line-subtle bg-surface sm:border-s">
                  <div className="flex h-14 items-center justify-between border-b border-line px-6">
                    <div className="flex items-center gap-3">
                      <h2 className="font-display text-xl font-bold tracking-tight text-fg">
                        {t("home.mockPriority")}
                      </h2>
                      <span className="border border-line px-2 py-0.5 font-mono text-xs font-medium tabular-nums text-fg-muted">
                        18
                      </span>
                    </div>
                    <span className="hidden font-mono text-xs text-fg-subtle md:inline">
                      {t("home.mockUpdated")}
                    </span>
                  </div>
                  <div className="divide-y divide-line-subtle">
                    {heroMessages.map((message) => (
                      <div
                        key={message.sender}
                        className="grid min-h-14 grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-3 px-5 text-sm sm:grid-cols-[28px_minmax(112px,180px)_1fr_auto]"
                      >
                        <message.icon className="h-4 w-4 text-fg-disabled" />
                        <span className="truncate font-semibold text-fg">
                          {message.sender}
                        </span>
                        {/* On a phone the row keeps the sender and the tag; a subject squeezed to a letter or two says nothing. */}
                        <span className="hidden truncate text-fg-muted sm:block">
                          <span className="font-medium text-fg">
                            {t(message.subjectKey)}
                          </span>
                          <span className="hidden text-fg-subtle md:inline">
                            {" "}
                            - {t(message.previewKey)}
                          </span>
                        </span>
                        <span className="border border-line px-2 py-0.5 font-display text-[11px] font-medium uppercase tracking-[0.08em] text-fg-muted">
                          {t(message.badgeKey)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* <section id="workflow" className="mx-auto grid max-w-7xl grid-cols-1 gap-6 px-4 pb-16 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:px-8">
					<div id="api" className="border border-line bg-surface p-6">
						<div className="mb-6 flex items-center justify-between gap-4">
							<div>
								<p className="text-sm font-semibold text-accent-text">Operational view</p>
								<h2 className="mt-1 text-2xl font-semibold tracking-tight">From DNS to delivery in one place.</h2>
							</div>
							<Clock3 className="hidden h-6 w-6 text-fg-subtle sm:block" />
						</div>
						<div className="grid gap-4 sm:grid-cols-3">
							{inboxStats.map((stat) => (
								<div key={stat.label} className="border-t border-line pt-4">
									<p className="font-display text-2xl font-semibold text-fg">{stat.value}</p>
									<p className="mt-1 text-sm text-fg-subtle">{stat.label}</p>
								</div>
							))}
						</div>
					</div>

					<div id="domains" className="border border-line bg-surface p-6">
						<p className="text-sm font-semibold text-accent-text">Delivery signals</p>
						<div className="mt-5 space-y-4">
							{deliverySignals.map((signal) => (
								<div key={signal} className="flex items-center gap-3 text-sm font-medium text-fg-muted">
									<CheckCircle2 className="h-5 w-5 text-accent-text" />
									<span>{signal}</span>
								</div>
							))}
						</div>
					</div>
				</section> */}
      </main>
    </div>
    </HomeAuthProvider>
  );
}
