-- Twin of SQLite migration 0089: message tallies kept by triggers on messages, so the sidebar
-- counts and JMAP Mailbox/get no longer GROUP BY every message of a mailbox. MySQL fires no
-- triggers for foreign key actions, so a deleted folder leaves its key behind; readers fold keys
-- naming a missing folder into folder_key '' (see src/lib/messages/counters.ts).
CREATE TABLE `message_counters` (
	`mailbox_id` varchar(191) NOT NULL,
	`folder_key` varchar(191) NOT NULL,
	`direction` varchar(64) NOT NULL,
	`status` varchar(191) NOT NULL,
	`read` boolean NOT NULL,
	`starred` boolean NOT NULL,
	`total` bigint NOT NULL DEFAULT 0,
	CONSTRAINT `message_counters_key_idx` UNIQUE(`mailbox_id`,`folder_key`,`direction`,`status`,`read`,`starred`)
);
--> statement-breakpoint
CREATE INDEX `messages_mailbox_snoozed_idx` ON `messages` (`mailbox_id`,`snoozed_until`,`folder_id`,`direction`,`status`,`read`,`starred`);--> statement-breakpoint
INSERT INTO message_counters (mailbox_id, folder_key, direction, status, `read`, starred, total)
SELECT mailbox_id, coalesce(folder_id, ''), direction, status, `read`, starred, count(*)
FROM messages
WHERE mailbox_id IS NOT NULL
GROUP BY mailbox_id, coalesce(folder_id, ''), direction, status, `read`, starred;--> statement-breakpoint
CREATE TRIGGER message_counters_ai AFTER INSERT ON messages FOR EACH ROW
BEGIN
	IF NEW.mailbox_id IS NOT NULL THEN
		INSERT INTO message_counters (mailbox_id, folder_key, direction, status, `read`, starred, total)
		VALUES (NEW.mailbox_id, coalesce(NEW.folder_id, ''), NEW.direction, NEW.status, NEW.`read`, NEW.starred, 1)
		ON DUPLICATE KEY UPDATE total = total + 1;
	END IF;
END;--> statement-breakpoint
CREATE TRIGGER message_counters_au AFTER UPDATE ON messages FOR EACH ROW
BEGIN
	IF NOT (OLD.mailbox_id <=> NEW.mailbox_id AND OLD.folder_id <=> NEW.folder_id AND OLD.direction <=> NEW.direction
		AND OLD.status <=> NEW.status AND OLD.`read` <=> NEW.`read` AND OLD.starred <=> NEW.starred) THEN
		IF OLD.mailbox_id IS NOT NULL THEN
			INSERT INTO message_counters (mailbox_id, folder_key, direction, status, `read`, starred, total)
			VALUES (OLD.mailbox_id, coalesce(OLD.folder_id, ''), OLD.direction, OLD.status, OLD.`read`, OLD.starred, -1)
			ON DUPLICATE KEY UPDATE total = total - 1;
		END IF;
		IF NEW.mailbox_id IS NOT NULL THEN
			INSERT INTO message_counters (mailbox_id, folder_key, direction, status, `read`, starred, total)
			VALUES (NEW.mailbox_id, coalesce(NEW.folder_id, ''), NEW.direction, NEW.status, NEW.`read`, NEW.starred, 1)
			ON DUPLICATE KEY UPDATE total = total + 1;
		END IF;
	END IF;
END;--> statement-breakpoint
CREATE TRIGGER message_counters_ad AFTER DELETE ON messages FOR EACH ROW
BEGIN
	IF OLD.mailbox_id IS NOT NULL THEN
		INSERT INTO message_counters (mailbox_id, folder_key, direction, status, `read`, starred, total)
		VALUES (OLD.mailbox_id, coalesce(OLD.folder_id, ''), OLD.direction, OLD.status, OLD.`read`, OLD.starred, -1)
		ON DUPLICATE KEY UPDATE total = total - 1;
	END IF;
END;
