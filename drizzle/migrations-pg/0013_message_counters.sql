-- Twin of SQLite migration 0089: message tallies kept by a trigger on messages, so the sidebar
-- counts and JMAP Mailbox/get no longer GROUP BY every message of a mailbox.
CREATE TABLE "message_counters" (
	"mailbox_id" text NOT NULL,
	"folder_key" text NOT NULL,
	"direction" text NOT NULL,
	"status" text NOT NULL,
	"read" boolean NOT NULL,
	"starred" boolean NOT NULL,
	"total" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "message_counters_key_idx" ON "message_counters" USING btree ("mailbox_id","folder_key","direction","status","read","starred");--> statement-breakpoint
CREATE INDEX "messages_mailbox_snoozed_idx" ON "messages" USING btree ("mailbox_id","snoozed_until","folder_id","direction","status","read","starred");--> statement-breakpoint
INSERT INTO message_counters (mailbox_id, folder_key, direction, status, "read", starred, total)
SELECT mailbox_id, coalesce(folder_id, ''), direction, status, "read", starred, count(*)
FROM messages
WHERE mailbox_id IS NOT NULL
GROUP BY mailbox_id, coalesce(folder_id, ''), direction, status, "read", starred;--> statement-breakpoint
CREATE FUNCTION mailclaw_count_message(p_mailbox text, p_folder text, p_direction text, p_status text, p_read boolean, p_starred boolean, p_delta bigint) RETURNS void AS $$
BEGIN
	INSERT INTO message_counters (mailbox_id, folder_key, direction, status, "read", starred, total)
	VALUES (p_mailbox, coalesce(p_folder, ''), p_direction, p_status, p_read, p_starred, p_delta)
	ON CONFLICT (mailbox_id, folder_key, direction, status, "read", starred)
	DO UPDATE SET total = message_counters.total + excluded.total;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE FUNCTION mailclaw_messages_counted() RETURNS trigger AS $$
BEGIN
	IF TG_OP = 'UPDATE' THEN
		IF OLD.mailbox_id IS NOT DISTINCT FROM NEW.mailbox_id
			AND OLD.folder_id IS NOT DISTINCT FROM NEW.folder_id
			AND OLD.direction IS NOT DISTINCT FROM NEW.direction
			AND OLD.status IS NOT DISTINCT FROM NEW.status
			AND OLD."read" IS NOT DISTINCT FROM NEW."read"
			AND OLD.starred IS NOT DISTINCT FROM NEW.starred THEN
			RETURN NULL;
		END IF;
	END IF;
	IF TG_OP IN ('UPDATE', 'DELETE') THEN
		IF OLD.mailbox_id IS NOT NULL THEN
			PERFORM mailclaw_count_message(OLD.mailbox_id, OLD.folder_id, OLD.direction, OLD.status, OLD."read", OLD.starred, -1);
		END IF;
	END IF;
	IF TG_OP IN ('INSERT', 'UPDATE') THEN
		IF NEW.mailbox_id IS NOT NULL THEN
			PERFORM mailclaw_count_message(NEW.mailbox_id, NEW.folder_id, NEW.direction, NEW.status, NEW."read", NEW.starred, 1);
		END IF;
	END IF;
	RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER messages_counted AFTER INSERT OR DELETE OR UPDATE OF mailbox_id, folder_id, direction, status, "read", starred ON messages
FOR EACH ROW EXECUTE FUNCTION mailclaw_messages_counted();
