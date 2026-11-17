-- Sidebar counts and JMAP Mailbox/get used to GROUP BY every message of a
-- mailbox on each call. message_counters keeps those tallies instead: one row
-- per (mailbox, folder, direction, status, read, starred), moved by the
-- triggers below on every insert, delete and change of a counted column.
-- folder_key is '' for messages outside a folder, so the unique key holds no
-- NULLs. Messages without a mailbox are not counted. The PostgreSQL and MySQL
-- twins are migrations-pg/0013 and migrations-mysql/0013.
CREATE TABLE `message_counters` (
	`mailbox_id` text NOT NULL,
	`folder_key` text NOT NULL,
	`direction` text NOT NULL,
	`status` text NOT NULL,
	`read` integer NOT NULL,
	`starred` integer NOT NULL,
	`total` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `message_counters_key_idx` ON `message_counters` (`mailbox_id`,`folder_key`,`direction`,`status`,`read`,`starred`);
--> statement-breakpoint
-- Snoozed messages are counted live (whether a snooze is current depends on
-- the clock), as a range on this index. It covers the grouped columns, or
-- SQLite prefers the covering messages_counts_cover_idx and walks the mailbox.
CREATE INDEX `messages_mailbox_snoozed_idx` ON `messages` (`mailbox_id`,`snoozed_until`,`folder_id`,`direction`,`status`,`read`,`starred`);
--> statement-breakpoint
INSERT INTO `message_counters` (`mailbox_id`, `folder_key`, `direction`, `status`, `read`, `starred`, `total`)
SELECT `mailbox_id`, coalesce(`folder_id`, ''), `direction`, `status`, `read`, `starred`, count(*)
FROM `messages`
WHERE `mailbox_id` IS NOT NULL
GROUP BY `mailbox_id`, coalesce(`folder_id`, ''), `direction`, `status`, `read`, `starred`;
--> statement-breakpoint
CREATE TRIGGER `message_counters_ai` AFTER INSERT ON `messages`
WHEN NEW.mailbox_id IS NOT NULL BEGIN
	INSERT INTO message_counters (mailbox_id, folder_key, direction, status, `read`, starred, total)
	VALUES (NEW.mailbox_id, coalesce(NEW.folder_id, ''), NEW.direction, NEW.status, NEW.`read`, NEW.starred, 1)
	ON CONFLICT (mailbox_id, folder_key, direction, status, `read`, starred) DO UPDATE SET total = total + 1;
END;
--> statement-breakpoint
CREATE TRIGGER `message_counters_au_old` AFTER UPDATE OF mailbox_id, folder_id, direction, status, `read`, starred ON `messages`
WHEN OLD.mailbox_id IS NOT NULL AND (
	OLD.mailbox_id IS NOT NEW.mailbox_id OR OLD.folder_id IS NOT NEW.folder_id OR OLD.direction IS NOT NEW.direction
	OR OLD.status IS NOT NEW.status OR OLD.`read` IS NOT NEW.`read` OR OLD.starred IS NOT NEW.starred
) BEGIN
	INSERT INTO message_counters (mailbox_id, folder_key, direction, status, `read`, starred, total)
	VALUES (OLD.mailbox_id, coalesce(OLD.folder_id, ''), OLD.direction, OLD.status, OLD.`read`, OLD.starred, -1)
	ON CONFLICT (mailbox_id, folder_key, direction, status, `read`, starred) DO UPDATE SET total = total - 1;
END;
--> statement-breakpoint
CREATE TRIGGER `message_counters_au_new` AFTER UPDATE OF mailbox_id, folder_id, direction, status, `read`, starred ON `messages`
WHEN NEW.mailbox_id IS NOT NULL AND (
	OLD.mailbox_id IS NOT NEW.mailbox_id OR OLD.folder_id IS NOT NEW.folder_id OR OLD.direction IS NOT NEW.direction
	OR OLD.status IS NOT NEW.status OR OLD.`read` IS NOT NEW.`read` OR OLD.starred IS NOT NEW.starred
) BEGIN
	INSERT INTO message_counters (mailbox_id, folder_key, direction, status, `read`, starred, total)
	VALUES (NEW.mailbox_id, coalesce(NEW.folder_id, ''), NEW.direction, NEW.status, NEW.`read`, NEW.starred, 1)
	ON CONFLICT (mailbox_id, folder_key, direction, status, `read`, starred) DO UPDATE SET total = total + 1;
END;
--> statement-breakpoint
CREATE TRIGGER `message_counters_ad` AFTER DELETE ON `messages`
WHEN OLD.mailbox_id IS NOT NULL BEGIN
	INSERT INTO message_counters (mailbox_id, folder_key, direction, status, `read`, starred, total)
	VALUES (OLD.mailbox_id, coalesce(OLD.folder_id, ''), OLD.direction, OLD.status, OLD.`read`, OLD.starred, -1)
	ON CONFLICT (mailbox_id, folder_key, direction, status, `read`, starred) DO UPDATE SET total = total - 1;
END;
