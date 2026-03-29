CREATE TABLE `calendar_event_map` (
	`google_event_id` text PRIMARY KEY NOT NULL,
	`calendar_id` text NOT NULL,
	`normalized_title` text NOT NULL,
	`last_seen_summary` text NOT NULL,
	`last_seen_start_utc` text NOT NULL,
	`last_seen_end_utc` text NOT NULL,
	`last_seen_location` text,
	`last_seen_description` text,
	`last_seen_start_label` text NOT NULL,
	`last_seen_url` text,
	`event_status` text DEFAULT 'active' NOT NULL,
	`is_recurring` integer DEFAULT false NOT NULL,
	`created_at_utc` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at_utc` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
