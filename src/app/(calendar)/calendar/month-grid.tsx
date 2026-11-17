"use client";

import { useMemo } from "react";
import clsx from "clsx";
import { useLanguage } from "@/components/language-provider";
import { normalizeCalendarColor } from "@/lib/calendar/colors";
import { formatUserDate } from "@/lib/time/utils";
import { addDays, dateKey, EVENT_COLOR_CLASSES, eventColorStyle, formatEventRange, isPendingInvite, monthGridDates, PAST_EVENT_COLOR_CLASSES, PENDING_EVENT_CLASSES } from "./utils";
import type { CalendarEvent } from "./types";

const MAX_VISIBLE = 3;

type MonthGridProps = {
	month: Date;
	today: Date;
	events: CalendarEvent[];
	currentTime: number;
	onSelectDay: (day: Date) => void;
	onOpenDay: (day: Date) => void;
	onEdit: (event: CalendarEvent) => void;
};

export function MonthGrid({ month, today, events, currentTime, onSelectDay, onOpenDay, onEdit }: MonthGridProps) {
	const { t } = useLanguage();
	const dates = useMemo(() => monthGridDates(month), [month]);
	const monthKey = dateKey(month).slice(0, 7);
	const todayKey = dateKey(today);
	const byDay = useMemo(() => {
		const map = new Map<string, CalendarEvent[]>();
		for (const day of dates) {
			const next = addDays(day, 1);
			const list = events
				.filter((event) => new Date(event.startsAt) < next && new Date(event.endsAt) > day)
				.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
			map.set(dateKey(day), list);
		}
		return map;
	}, [dates, events]);

	return (
		<div className="flex min-h-full min-w-[640px] flex-col">
			<div className="sticky top-0 z-30 grid grid-cols-7 border-b border-line bg-surface">
				{([0, 1, 2, 3, 4, 5, 6] as const).map((weekday) => (
					<span key={weekday} className="border-s border-line-subtle px-2 py-2 font-display text-[11px] font-medium uppercase tracking-wider text-fg-subtle first:border-s-0">{t(`calendar.weekdayShort.${weekday}`)}</span>
				))}
			</div>
			<div className="grid flex-1 grid-cols-7 grid-rows-6">
				{dates.map((day) => {
					const key = dateKey(day);
					const list = byDay.get(key) ?? [];
					const outside = key.slice(0, 7) !== monthKey;
					const extra = list.length - MAX_VISIBLE;
					return (
						<div key={key} className={clsx("relative min-h-28 border-b border-s border-line-subtle p-1 [&:nth-child(7n+1)]:border-s-0", outside && "bg-canvas-subtle")}>
							<button type="button" aria-label={t("calendar.addEventOn", { date: formatUserDate(day, { dateStyle: "short" }) })} onClick={() => onSelectDay(day)} className="absolute inset-0 z-0 cursor-pointer" />
							<button type="button" onClick={() => onOpenDay(day)} className={clsx("relative z-10 mb-1 me-auto flex h-7 min-w-7 items-center justify-center px-1 font-display text-sm font-medium tabular-nums",
								key === todayKey ? "bg-accent text-on-accent hover:bg-accent-hover" : outside ? "text-fg-subtle hover:bg-surface-hover" : "text-fg hover:bg-surface-hover")}>
								{formatUserDate(day, { day: "numeric" })}
							</button>
							<div className="relative z-10 space-y-0.5">
								{list.slice(0, MAX_VISIBLE).map((event) => {
									const color = normalizeCalendarColor(event.color);
									const past = new Date(event.endsAt).getTime() <= currentTime;
									return (
										<button key={`${event.id}-${event.startsAt}`} type="button" onClick={() => onEdit(event)} title={`${event.title} · ${formatEventRange(event)}`}
											style={eventColorStyle(color)}
											className={clsx("block w-full truncate px-1.5 py-0.5 text-start text-[11px] font-medium hover:brightness-95", isPendingInvite(event) ? PENDING_EVENT_CLASSES : past ? PAST_EVENT_COLOR_CLASSES : EVENT_COLOR_CLASSES)}>
											{event.title}
										</button>
									);
								})}
								{extra > 0 && (
									<button type="button" onClick={() => onOpenDay(day)} className="block w-full px-1.5 text-start text-[11px] font-medium text-fg-muted hover:bg-surface-hover">
										{t("calendar.moreEvents", { count: extra })}
									</button>
								)}
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}
