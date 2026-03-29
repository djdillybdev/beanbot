CREATE TABLE `todoist_task_map` (
	`todoist_task_id` text PRIMARY KEY NOT NULL,
	`normalized_title` text NOT NULL,
	`last_seen_content` text NOT NULL,
	`last_seen_due_label` text,
	`last_seen_due_date` text,
	`last_seen_url` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at_utc` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at_utc` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
