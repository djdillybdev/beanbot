ALTER TABLE `todoist_task_map` ADD COLUMN `last_seen_section_id` text;
--> statement-breakpoint
ALTER TABLE `todoist_task_map` ADD COLUMN `last_seen_parent_id` text;
--> statement-breakpoint
ALTER TABLE `todoist_task_map` ADD COLUMN `last_seen_order_index` integer;
--> statement-breakpoint
ALTER TABLE `todoist_task_map` ADD COLUMN `last_seen_created_at_utc` text;
--> statement-breakpoint
ALTER TABLE `todoist_task_map` ADD COLUMN `last_seen_updated_at_utc` text;
--> statement-breakpoint
CREATE TABLE `task_completion` (
	`event_key` text PRIMARY KEY NOT NULL,
	`todoist_task_id` text NOT NULL,
	`normalized_title` text NOT NULL,
	`title` text NOT NULL,
	`completed_at_utc` text NOT NULL,
	`completed_local_date` text NOT NULL,
	`source` text NOT NULL,
	`priority` integer DEFAULT 1 NOT NULL,
	`project_id` text,
	`project_name` text,
	`recurring` integer DEFAULT false NOT NULL,
	`due_date` text,
	`due_datetime_utc` text,
	`due_string` text,
	`labels_csv` text,
	`url` text NOT NULL,
	`provisional` integer DEFAULT false NOT NULL,
	`created_at_utc` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `task_completion_task_idx`
ON `task_completion` (`todoist_task_id`, `completed_at_utc`);
--> statement-breakpoint
CREATE INDEX `task_completion_local_date_idx`
ON `task_completion` (`completed_local_date`, `completed_at_utc`);
--> statement-breakpoint
CREATE INDEX `task_completion_task_local_date_idx`
ON `task_completion` (`todoist_task_id`, `completed_local_date`, `provisional`);
--> statement-breakpoint
INSERT INTO `task_completion` (
  `event_key`,
  `todoist_task_id`,
  `normalized_title`,
  `title`,
  `completed_at_utc`,
  `completed_local_date`,
  `source`,
  `priority`,
  `project_id`,
  `project_name`,
  `recurring`,
  `url`,
  `provisional`
)
SELECT
  `dedupe_key`,
  `todoist_task_id`,
  `normalized_title`,
  `title`,
  `completed_at_utc`,
  `completed_local_date`,
  `source`,
  `priority`,
  `project_id`,
  `project_name`,
  true,
  `url`,
  false
FROM `habit_completion_history`
WHERE true
ON CONFLICT(`event_key`) DO NOTHING;
