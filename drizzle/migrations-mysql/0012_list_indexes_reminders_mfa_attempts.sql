-- Sent, Archived, Spam and Trash filter on status without folder_id, and
-- Starred spans every status; no index put created_at right after those
-- predicates, so each page read and sorted the whole folder. MySQL builds
-- descending key parts ascending and scans them backwards (see kits.ts).
CREATE INDEX `messages_status_page_idx` ON `messages` (`mailbox_id`,`status`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `messages_starred_page_idx` ON `messages` (`mailbox_id`,`starred`,`created_at`,`id`);--> statement-breakpoint
-- The inbound duplicate check filters on mailbox_id and raw_r2_key.
DROP INDEX `messages_raw_r2_key_idx` ON `messages`;--> statement-breakpoint
CREATE INDEX `messages_raw_r2_key_idx` ON `messages` (`raw_r2_key`,`mailbox_id`);--> statement-breakpoint
-- Redundant: the indexes above and messages_thread_idx start with mailbox_id
-- (and keep serving its foreign key); on MySQL messages_inbox_page_idx had the
-- same columns as messages_nav_cover_idx.
DROP INDEX `messages_mailbox_idx` ON `messages`;--> statement-breakpoint
DROP INDEX `messages_inbox_page_idx` ON `messages`;--> statement-breakpoint
-- The reminder cron reads one-off events in the coming week and recurring
-- events, instead of every past event of every user.
CREATE INDEX `calendar_events_reminder_idx` ON `calendar_events` (`repeat`,`starts_at`);--> statement-breakpoint
-- Second-factor codes tried against a login challenge.
ALTER TABLE `login_challenges` ADD `attempts` bigint NOT NULL DEFAULT 0;
