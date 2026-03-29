ALTER TABLE `todoist_task_map` ADD `last_seen_due_datetime_utc` text;
--> statement-breakpoint
CREATE TABLE `reminder_jobs__new` (
	`id` text PRIMARY KEY NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text NOT NULL,
	`reminder_kind` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`remind_at_utc` text NOT NULL,
	`channel_id` text NOT NULL,
	`payload_json` text NOT NULL,
	`delivered_at_utc` text,
	`status` text NOT NULL,
	`created_at_utc` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at_utc` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
INSERT INTO `reminder_jobs__new` (
	`id`,
	`source_type`,
	`source_id`,
	`reminder_kind`,
	`dedupe_key`,
	`remind_at_utc`,
	`channel_id`,
	`payload_json`,
	`delivered_at_utc`,
	`status`,
	`created_at_utc`,
	`updated_at_utc`
)
SELECT
	`id`,
	`source_type`,
	`source_id`,
	'task_overdue',
	`id`,
	`remind_at_utc`,
	`channel_id`,
	'{"kind":"task_overdue","title":"Legacy reminder","priority":1,"url":"","localDate":"1970-01-01"}',
	`delivered_at_utc`,
	`status`,
	`created_at_utc`,
	COALESCE(`delivered_at_utc`, `created_at_utc`)
FROM `reminder_jobs`;
--> statement-breakpoint
DROP TABLE `reminder_jobs`;
--> statement-breakpoint
ALTER TABLE `reminder_jobs__new` RENAME TO `reminder_jobs`;
--> statement-breakpoint
CREATE UNIQUE INDEX `reminder_jobs_dedupe_key_idx` ON `reminder_jobs` (`dedupe_key`);
--> statement-breakpoint
CREATE INDEX `reminder_jobs_status_remind_at_idx` ON `reminder_jobs` (`status`, `remind_at_utc`);
