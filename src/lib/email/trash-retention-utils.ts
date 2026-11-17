import { defaultTranslator, type Translator } from "../i18n/utils";

/** Choices offered in Settings; any whole number in range is accepted by the API. */
export const TRASH_RETENTION_OPTIONS = [7, 14, 30, 60, 90] as const;
export const MIN_TRASH_RETENTION_DAYS = 1;
export const MAX_TRASH_RETENTION_DAYS = 365;
/** Messages purged per scheduled run, so one invocation stays well inside Worker limits. */
export const TRASH_RETENTION_BATCH_SIZE = 200;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The five-minute cron trigger in wrangler.jsonc that also carries the hourly retention run. */
export const FREQUENT_CRON = "*/5 * * * *";

/**
 * Retention only needs to run hourly, not on every five-minute tick: the cron run shares a small
 * CPU budget with the other upkeep jobs. Workers run it on the five-minute trigger that lands on
 * minute 0 (24 runs a day, up to 24 x TRASH_RETENTION_BATCH_SIZE messages), so the daily trigger
 * at 02:00 does not run it a second time.
 */
export function shouldRunTrashRetention(cron: string, scheduledTime: number | Date): boolean {
	return cron === FREQUENT_CRON && new Date(scheduledTime).getUTCMinutes() === 0;
}

/**
 * The Node scheduler ticks every minute and its timer drifts, so it may never fire on minute 0 of
 * some hour. It runs retention on the first tick of each UTC hour instead: this key changes once
 * an hour and the caller runs when it differs from the last one it saw.
 */
export function trashRetentionHourKey(now: Date): string {
	return now.toISOString().slice(0, 13);
}

/** Messages that entered Trash or Spam before this instant are due for deletion. */
export function getTrashRetentionCutoff(now: Date, days: number): Date {
	return new Date(now.getTime() - days * DAY_MS);
}

/** Null (or anything outside the supported range) means "never delete automatically". */
export function normalizeTrashRetentionDays(value: unknown): number | null {
	if (typeof value !== "number" || !Number.isInteger(value)) return null;
	if (value < MIN_TRASH_RETENTION_DAYS || value > MAX_TRASH_RETENTION_DAYS) return null;
	return value;
}

export function describeTrashRetention(days: number | null, t: Translator = defaultTranslator): string {
	if (!days) return t("settings.trash.never");
	return t("settings.trash.afterDay", { count: days });
}
