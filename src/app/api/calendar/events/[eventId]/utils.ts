import { z } from "zod";

/** Event bodies are a few kilobytes; descriptions and guest lists are the long parts. */
export const CALENDAR_EVENT_BODY_MAX_BYTES = 256 * 1024;

const optionalText = z.string().max(100_000).nullish();
const dateValue = z.union([z.string().max(100), z.number()]);

/**
 * The shape of a PATCH body. Only types are checked here; required fields, dates and value ranges
 * are checked by the route (and normalized by the calendar helpers) with their own messages.
 */
export const calendarEventPatchSchema = z.object({
	title: optionalText,
	description: optionalText,
	location: optionalText,
	attendees: z.array(z.string().max(1000)).max(1000).nullish(),
	color: z.string().max(100).nullish(),
	repeat: z.string().max(50).nullish(),
	repeatDays: z.array(z.number()).max(7).nullish(),
	repeatAnchorDay: z.number().nullish(),
	// Absent keeps the event's reminder; null (or anything out of range) clears it.
	reminderMinutes: z.unknown().optional(),
	timeZone: z.string().max(100).nullish(),
	effectiveFrom: dateValue.nullish(),
	moveOccurrenceToPast: z.boolean().nullish(),
	startsAt: dateValue.nullish(),
	endsAt: dateValue.nullish(),
	mailboxId: z.string().max(200).nullish(),
	from: z.string().max(1000).nullish(),
});

/** A DELETE body is optional; when present it may only say where a series ends. */
export const calendarEventDeleteSchema = z.object({
	effectiveFrom: dateValue.nullish(),
});
