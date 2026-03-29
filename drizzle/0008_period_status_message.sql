CREATE TABLE `period_status_message` (
	`status_type` text NOT NULL,
	`period_key` text NOT NULL,
	`channel_id` text NOT NULL,
	`message_id` text NOT NULL,
	`snapshot_json` text NOT NULL,
	`is_pinned` integer DEFAULT false NOT NULL,
	`created_at_utc` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at_utc` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE UNIQUE INDEX `period_status_message_type_period_idx` ON `period_status_message` (`status_type`,`period_key`);
CREATE INDEX `period_status_message_channel_type_idx` ON `period_status_message` (`channel_id`,`status_type`);
