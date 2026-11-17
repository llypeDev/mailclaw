import { runScheduledDatabaseBackup } from "@/lib/backups/runner";
import { runAgentMaintenance } from "@/lib/agent/maintenance";
import { runTrashRetention } from "@/lib/email/trash-retention";
import { runDriveTrashRetention } from "@/lib/drive/retention";
import { runAccountRetention } from "@/lib/accounts/deletion";
import { runJmapChangeRetention } from "@/lib/jmap/changes";
import { runMessageCounterRebuild } from "@/lib/messages/counters";
import { runFollowUpReminders } from "@/lib/follow-ups/service";
import { runCalendarReminders } from "@/lib/calendar/reminders";
import { sweepImportJobs } from "@/lib/import/jobs";
import { sweepOrphanedRawMail } from "@/lib/email/raw-sweeper";
import { sweepStuckOutboundJobs } from "@/lib/email/send";
import { trashRetentionHourKey } from "@/lib/email/trash-retention-utils";
import { runDatabaseOptimize } from "@/lib/migrations/optimize";

/** Fire the daily 02:00 UTC backup and the recurring maintenance jobs, matching the cron triggers in wrangler.jsonc. */
export function startScheduler(env: CloudflareEnv) {
	let lastRunDay = "";
	let lastTrashHour = "";
	// The server starts this after applying migrations: give SQLite planner statistics for any new
	// tables and indexes now (SQLite's advice for a freshly opened long-lived connection), then daily.
	void runDatabaseOptimize(env);
	const timer = setInterval(() => {
		const now = new Date();
		runAgentMaintenance(env).catch((error) => console.error("Agent maintenance failed", error));
		// Hourly, like the Worker (the first tick of each UTC hour, since this timer drifts past minute 0).
		const trashHour = trashRetentionHourKey(now);
		if (trashHour !== lastTrashHour) {
			lastTrashHour = trashHour;
			runTrashRetention(env, now).catch((error) => console.error("Trash retention failed", error));
		}
		sweepImportJobs(env).catch((error) => console.error("Import job sweep failed", error));
		sweepStuckOutboundJobs(env).catch((error) => console.error("Stuck outbound job sweep failed", error));
		runFollowUpReminders(env, now).catch((error) => console.error("Follow-up reminders failed", error));
		runCalendarReminders(env, now).catch((error) => console.error("Calendar reminders failed", error));
		const day = now.toISOString().slice(0, 10);
		if (now.getUTCHours() !== 2 || lastRunDay === day) return;
		lastRunDay = day;
		runScheduledDatabaseBackup(env, now).catch((error) => console.error("Scheduled backup failed", error));
		runDriveTrashRetention(env, now).catch((error) => console.error("Drive trash retention failed", error));
		// MySQL only: recount message tallies after the purge, whose cascades fire no triggers there.
		runAccountRetention(env, now)
			.catch((error) => console.error("Account retention failed", error))
			.then(() => runMessageCounterRebuild(env));
		runJmapChangeRetention(env, now).catch((error) => console.error("JMAP change retention failed", error));
		sweepOrphanedRawMail(env, now).catch((error) => console.error("Raw mail sweep failed", error));
		void runDatabaseOptimize(env);
	}, 60_000);
	return () => clearInterval(timer);
}
