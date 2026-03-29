CREATE TABLE `today_status_message` (
	`date_key` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`message_id` text NOT NULL,
	`snapshot_json` text NOT NULL,
	`is_pinned` integer DEFAULT false NOT NULL,
	`created_at_utc` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at_utc` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
