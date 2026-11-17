"use client";

import { usePathname } from "next/navigation";
import { Skeleton, SkeletonRows } from "@/components/ui/skeleton";

function HeaderBar({ tabs = 0 }: { tabs?: number }) {
	return (
		<div className="flex h-16 items-center gap-3 px-4">
			<Skeleton className="h-10 w-10 shrink-0" />
			<Skeleton className="hidden h-6 w-28 md:block" />
			{tabs > 0 && <Skeleton className="ms-3 hidden h-10 md:block" style={{ width: `${tabs * 5}rem` }} />}
			<div className="flex-1" />
			<Skeleton className="h-9 w-9 rounded-full" />
		</div>
	);
}

/** Calendar: left upcoming panel and a week grid under the toolbar. */
function CalendarSkeleton() {
	return (
		<div className="flex h-dvh flex-col bg-canvas">
			<div className="flex h-16 items-center gap-3 px-4">
				<Skeleton className="h-10 w-10 shrink-0" />
				<Skeleton className="hidden h-6 w-28 md:block" />
				<Skeleton className="ms-3 hidden h-10 w-48 md:block" />
				<Skeleton className="h-5 w-32" />
				<div className="flex-1" />
				<Skeleton className="h-10 w-10" />
				<Skeleton className="h-10 w-10" />
				<Skeleton className="hidden h-10 w-20 md:block" />
				<Skeleton className="h-10 w-36" />
			</div>
			<div className="flex min-h-0 flex-1 gap-3 ps-3 max-md:ps-0">
				<div className="hidden w-64 shrink-0 space-y-4 border border-b-0 border-line-subtle bg-surface p-5 lg:block">
					{Array.from({ length: 4 }, (_, group) => (
						<div key={group} className="space-y-2">
							<Skeleton className="h-3 w-24" />
							<Skeleton className="h-12 w-full" />
							<Skeleton className="h-12 w-full" />
						</div>
					))}
				</div>
				<div className="min-w-0 flex-1 overflow-hidden border border-b-0 border-line-subtle bg-surface max-md:border-x-0">
					<div className="grid h-14 border-b border-line" style={{ gridTemplateColumns: "64px repeat(7, minmax(0, 1fr))" }}>
						<div />
						{Array.from({ length: 7 }, (_, day) => <div key={day} className="flex flex-col gap-1.5 border-s border-line-subtle px-3 py-2"><Skeleton className="h-3 w-8" /><Skeleton className="h-4 w-6" /></div>)}
					</div>
					<div className="grid" style={{ gridTemplateColumns: "64px repeat(7, minmax(0, 1fr))" }}>
						<div className="space-y-12 p-3">{Array.from({ length: 8 }, (_, hour) => <Skeleton key={hour} className="h-3 w-8" />)}</div>
						{Array.from({ length: 7 }, (_, day) => <div key={day} className="space-y-10 border-s border-line-subtle p-2">{day % 2 === 0 && <Skeleton className="h-16 w-full" />}{day % 3 === 0 && <Skeleton className="h-10 w-full" />}</div>)}
					</div>
				</div>
			</div>
		</div>
	);
}

/** Mail folders and message pages: folder rail plus a list of rows. */
function MailSkeleton() {
	return (
		<div className="flex h-dvh flex-col bg-canvas">
			<HeaderBar />
			<div className="flex min-h-0 flex-1 gap-3 ps-3 max-md:ps-0">
				<div className="hidden w-60 shrink-0 space-y-2 md:block">
					<Skeleton className="mb-4 h-12 w-36" />
					{Array.from({ length: 7 }, (_, row) => <Skeleton key={row} className="h-9 w-full" />)}
				</div>
				<div className="min-w-0 flex-1 overflow-hidden border border-b-0 border-line-subtle bg-surface max-md:border-x-0"><SkeletonRows count={10} /></div>
			</div>
		</div>
	);
}

function GenericSkeleton() {
	return (
		<div className="flex h-dvh flex-col bg-canvas">
			<HeaderBar />
			<div className="min-h-0 flex-1 overflow-hidden px-4">
				<Skeleton className="mb-4 h-8 w-56" />
				<div className="overflow-hidden border border-line-subtle bg-surface"><SkeletonRows count={8} /></div>
			</div>
		</div>
	);
}

const MAIL_PREFIXES = ["/inbox", "/sent", "/drafts", "/starred", "/snoozed", "/scheduled", "/archived", "/spam", "/trash", "/folders", "/contacts"];

/** Placeholder shown while auth resolves, shaped like the page being opened so the layout does not jump. */
export function RouteSkeleton() {
	const pathname = usePathname() ?? "";
	if (pathname === "/calendar" || pathname.startsWith("/calendar/")) return <CalendarSkeleton />;
	if (MAIL_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) return <MailSkeleton />;
	return <GenericSkeleton />;
}
