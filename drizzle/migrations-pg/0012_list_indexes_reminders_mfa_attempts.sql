-- Sent, Archived, Spam and Trash filter on status without folder_id, and
-- Starred spans every status; no index put created_at right after those
-- predicates, so each page read and sorted the whole folder.
CREATE INDEX IF NOT EXISTS "messages_status_page_idx" ON "messages" USING btree ("mailbox_id","status","created_at" desc,"id" desc);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_starred_page_idx" ON "messages" USING btree ("mailbox_id","starred","created_at" desc,"id" desc);--> statement-breakpoint
-- The inbound duplicate check filters on mailbox_id and raw_r2_key.
DROP INDEX IF EXISTS "messages_raw_r2_key_idx";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_raw_r2_key_idx" ON "messages" USING btree ("raw_r2_key","mailbox_id");--> statement-breakpoint
-- Redundant: every index above and messages_thread_idx start with mailbox_id,
-- and messages_nav_cover_idx begins with messages_inbox_page_idx's columns.
DROP INDEX IF EXISTS "messages_mailbox_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "messages_inbox_page_idx";--> statement-breakpoint
-- The reminder cron reads one-off events in the coming week and recurring
-- events, instead of every past event of every user.
CREATE INDEX IF NOT EXISTS "calendar_events_reminder_idx" ON "calendar_events" USING btree ("repeat","starts_at");--> statement-breakpoint
-- Second-factor codes tried against a login challenge.
ALTER TABLE "login_challenges" ADD COLUMN "attempts" bigint DEFAULT 0 NOT NULL;
