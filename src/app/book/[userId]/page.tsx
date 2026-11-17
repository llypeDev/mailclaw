"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { EmptyState } from "@orangesys/ui";
import { ArrowRight, CalendarDays, Clock3, MapPin } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { LanguageSelector } from "@/components/language-selector";
import { useBranding } from "@/components/branding-provider";
import { RouteLoadingBar } from "@/components/route-loading-bar";
import type { PublicBookingEvent } from "./types";
import { BookingListSkeleton } from "./booking-list-skeleton";

export default function PublicBookingListPage() {
	const { t } = useLanguage();
	const branding = useBranding();
	const params = useParams();
	const userId = typeof params.userId === "string" ? params.userId : undefined;
	const username = typeof params.username === "string" ? params.username : undefined;
	const query = username ? `username=${encodeURIComponent(username)}` : `userId=${encodeURIComponent(userId ?? "")}`;
	const [name, setName] = useState("");
	const [events, setEvents] = useState<PublicBookingEvent[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	useEffect(() => {
		let active = true;
		void fetch(`/api/public/booking?${query}`).then(async (response) => {
			if (!response.ok) throw new Error();
			return response.json() as Promise<{ name: string; events: PublicBookingEvent[] }>;
		}).then((data) => { if (active) { setName(data.name); setEvents(data.events); } }).catch(() => { if (active) setError(t("public.listUnavailable")); }).finally(() => { if (active) setLoading(false); });
		return () => { active = false; };
	}, [query, t]);
	return <main className="page-transition-enter flex min-h-dvh flex-col bg-canvas p-4 text-fg lg:pt-12">
		{loading && <RouteLoadingBar />}
		<div className="mx-auto flex w-full max-w-2xl flex-1 flex-col">
			<div className="mb-7"><h1 className="text-2xl font-semibold tracking-[-0.02em] md:text-3xl">{name ? t("public.bookMeetingWith", { name }) : t("public.bookMeeting")}</h1><p className="mt-2 text-sm text-fg-muted">{t("public.chooseMeeting")}</p></div>
			{loading ? <BookingListSkeleton /> : error ? <p role="alert" className="border border-line bg-surface p-6 text-sm text-fg-muted">{error}</p> : events.length === 0 ? <EmptyState className="border border-line bg-surface" headingLevel={2} icon={<CalendarDays className="h-6 w-6" aria-hidden="true" />} title={t("public.noMeetings")} /> : <div className="page-transition-enter divide-y divide-line border border-line bg-surface">{events.map((event) => <Link key={event.id} href={username ? `/c/${username}/${event.slug}` : `/book/${userId}/${event.id}`} className="group flex items-center gap-4 p-5 transition-colors hover:bg-surface-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"><div className="min-w-0 flex-1"><h2 className="font-semibold group-hover:text-accent-text">{event.name}</h2>{event.description && <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-sm text-fg-muted">{event.description}</p>}<p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-fg-subtle"><span className="inline-flex items-center gap-1"><Clock3 className="h-4 w-4" />{t("public.minutesLong", { count: event.durationMinutes })}</span>{event.location && <span className="inline-flex items-center gap-1"><MapPin className="h-4 w-4" />{event.location}</span>}</p></div><ArrowRight aria-hidden="true" className="h-5 w-5 shrink-0 text-fg-subtle group-hover:text-accent-text rtl:-scale-x-100" /></Link>)}</div>}
			<div className="mt-auto flex min-w-0 flex-wrap items-center justify-between gap-3 pt-10 text-fg-muted">
				<div className="w-44"><LanguageSelector /></div>
				{/* The brand mark and its name stay together at the end of the row. */}
				<div className="flex min-w-0 items-center gap-3">
					{/* eslint-disable-next-line @next/next/no-img-element -- branding icon (API route or small static PNG) at a fixed size */}
					<img src={branding.iconUrl} width={24} height={24} alt={branding.appName || "Mailclaw"} />
					<span className="truncate font-semibold">{branding.appName}</span>
				</div>
			</div>
		</div>
	</main>;
}
