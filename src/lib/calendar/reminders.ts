import { and, asc, eq, exists, gt, gte, inArray, isNotNull, isNull, lt, lte, ne, or, sql, type SQL } from "drizzle-orm";
import { getDb, type AppDatabase } from "@/db";
import { calendarEvents, users } from "@/db/schema";
import { isMissingColumnError } from "@/lib/database-errors";
import { sendPushContent } from "@/lib/push/server";
import { normalizeTimeZone } from "@/lib/time/utils";
import { expandToolEvents } from "./tool-occurrences";
import { MAX_REMINDER_MINUTES, formatReminderBody } from "./reminder-utils";

/** Events read per query; the run pages through every candidate so none is starved. */
const REMINDER_BATCH = 500;
/** Occurrences reminded per event per run, so a long lead time on a daily event cannot flood a device. */
const MAX_OCCURRENCES_PER_EVENT = 3;
/** Every repeat rule but "none", listed so the index can seek them (it cannot seek `<> 'none'`). */
const RECURRING_RULES = calendarEvents.repeat.enumValues.filter((rule) => rule !== "none");

type CalendarEventRow = typeof calendarEvents.$inferSelect;

/**
 * Five-minute cron: sends a push for each occurrence whose start minus the event's reminder offset has passed
 * and which has not started yet. The occurrence start is claimed on the row before sending, so overlapping runs
 * and retries never notify twice.
 */
export async function runCalendarReminders(env: CloudflareEnv, now: Date): Promise<void> {
	try {
		const db = getDb(env);
		for (const condition of reminderCandidates(db, now)) {
			for await (const page of reminderPages(db, condition)) {
				for (const event of page) await remindEvent(env, db, event, now);
			}
		}
	} catch (error) {
		// Before migrations 0078/0080 the reminder and calendar_enabled columns do not exist; nothing to remind about yet.
		if (!isMissingColumnError(error)) throw error;
	}
}

/**
 * The events that may have an occurrence to remind about, as two conditions that each read a narrow range of
 * calendar_events_reminder_idx (repeat, starts_at) instead of every past event of every user.
 */
function reminderCandidates(db: AppDatabase, now: Date): SQL[] {
	const horizon = new Date(now.getTime() + MAX_REMINDER_MINUTES * 60_000);
	// Timestamps are whole seconds on every dialect, so the offset is applied in SQL.
	const offsetReached = sql`${calendarEvents.startsAt} - ${calendarEvents.reminderMinutes} * 60 <= ${Math.floor(now.getTime() / 1000)}`;
	// Accounts with Calendar hidden get no reminders: they cannot open the event anyway.
	const calendarShown = exists(
		db.select({ id: users.id }).from(users).where(and(eq(users.id, calendarEvents.userId), eq(users.calendarEnabled, true))),
	);
	const common = and(isNotNull(calendarEvents.reminderMinutes), lte(calendarEvents.startsAt, horizon), offsetReached, calendarShown)!;
	return [
		// One-off events whose reminder is due and not yet sent: the set empties as reminders go out.
		and(
			common,
			eq(calendarEvents.repeat, "none"),
			gt(calendarEvents.startsAt, now),
			or(isNull(calendarEvents.lastRemindedStart), lt(calendarEvents.lastRemindedStart, calendarEvents.startsAt)),
		)!,
		// A series can be due long after its first occurrence, so every one still running is looked at.
		and(
			common,
			inArray(calendarEvents.repeat, RECURRING_RULES),
			or(isNull(calendarEvents.repeatUntil), gt(calendarEvents.repeatUntil, now)),
		)!,
	];
}

/** Pages ordered by (starts_at, id), resumed after the last row, so every candidate is read once per run. */
async function* reminderPages(db: AppDatabase, condition: SQL): AsyncGenerator<CalendarEventRow[]> {
	let after: SQL | undefined;
	for (;;) {
		const page = await db
			.select()
			.from(calendarEvents)
			.where(and(condition, after))
			.orderBy(asc(calendarEvents.startsAt), asc(calendarEvents.id))
			.limit(REMINDER_BATCH);
		yield page;
		if (page.length < REMINDER_BATCH) return;
		const last = page[page.length - 1];
		// Spelled without `OR starts_at > ?` so SQLite keeps the index range instead of an OR-union plan.
		after = and(
			gte(calendarEvents.startsAt, last.startsAt),
			or(ne(calendarEvents.startsAt, last.startsAt), gt(calendarEvents.id, last.id)),
		);
	}
}

async function remindEvent(env: CloudflareEnv, db: AppDatabase, event: CalendarEventRow, now: Date): Promise<void> {
	const lead = (event.reminderMinutes ?? 0) * 60_000;
	const last = event.lastRemindedStart?.getTime() ?? 0;
	const due = expandToolEvents([event], now, new Date(now.getTime() + lead + 1))
		.map((occurrence) => ({ ...occurrence, start: new Date(occurrence.startsAt) }))
		.filter((occurrence) => occurrence.start > now && occurrence.start.getTime() - lead <= now.getTime() && occurrence.start.getTime() > last)
		.slice(0, MAX_OCCURRENCES_PER_EVENT);
	if (!due.length) return;

	const newest = due[due.length - 1].start;
	const claimed = await db
		.update(calendarEvents)
		.set({ lastRemindedStart: newest })
		.where(and(
			eq(calendarEvents.id, event.id),
			or(isNull(calendarEvents.lastRemindedStart), lt(calendarEvents.lastRemindedStart, newest)),
		))
		.returning({ id: calendarEvents.id });
	if (!claimed.length) return;

	const zone = normalizeTimeZone(event.timeZone);
	for (const occurrence of due) {
		await sendPushContent(env, [event.userId], {
			title: event.title.slice(0, 180),
			body: formatReminderBody(occurrence.start, zone, event.location),
			tag: `calendar:${event.id}:${occurrence.start.getTime()}`,
			url: "/calendar",
		});
	}
}
