CREATE TABLE `habit_completion_history` (
	`dedupe_key` text PRIMARY KEY NOT NULL,
	`todoist_task_id` text NOT NULL,
	`normalized_title` text NOT NULL,
	`title` text NOT NULL,
	`completed_at_utc` text NOT NULL,
	`completed_local_date` text NOT NULL,
	`source` text NOT NULL,
	`priority` integer DEFAULT 1 NOT NULL,
	`project_id` text,
	`project_name` text,
	`url` text NOT NULL,
	`created_at_utc` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `habit_completion_history_task_idx`
ON `habit_completion_history` (`todoist_task_id`, `completed_at_utc`);
--> statement-breakpoint
CREATE INDEX `habit_completion_history_local_date_idx`
ON `habit_completion_history` (`completed_local_date`, `completed_at_utc`);
