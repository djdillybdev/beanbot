CREATE TABLE `action_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`action_type` text NOT NULL,
	`source_command` text NOT NULL,
	`payload_json` text,
	`result_json` text,
	`created_at_utc` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `app_config` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`timezone` text NOT NULL,
	`default_calendar_id` text NOT NULL,
	`digest_channel_id` text NOT NULL,
	`reminders_channel_id` text NOT NULL,
	`inbox_channel_id` text NOT NULL,
	`planning_channel_id` text,
	`created_at_utc` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at_utc` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reminder_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text NOT NULL,
	`remind_at_utc` text NOT NULL,
	`channel_id` text NOT NULL,
	`delivered_at_utc` text,
	`status` text NOT NULL,
	`created_at_utc` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
