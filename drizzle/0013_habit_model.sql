ALTER TABLE `todoist_task_map` ADD COLUMN `last_seen_recurring` integer DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE TABLE `habit` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`todoist_task_id` text,
	`title` text NOT NULL,
	`normalized_title` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`project_id` text,
	`project_name` text,
	`todoist_url` text,
	`raw_recurrence_text` text,
	`schedule_kind` text DEFAULT 'unparsed' NOT NULL,
	`schedule_json` text DEFAULT '{}' NOT NULL,
	`current_streak` integer DEFAULT 0 NOT NULL,
	`longest_streak` integer DEFAULT 0 NOT NULL,
	`last_completed_local_date` text,
	`completion_count` integer DEFAULT 0 NOT NULL,
	`streak_updated_at_utc` text,
	`created_at_utc` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at_utc` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `habit_todoist_task_id_idx`
ON `habit` (`todoist_task_id`);
--> statement-breakpoint
CREATE INDEX `habit_active_idx`
ON `habit` (`is_active`, `updated_at_utc`);
--> statement-breakpoint
CREATE INDEX `habit_normalized_title_idx`
ON `habit` (`normalized_title`);
--> statement-breakpoint
CREATE TABLE `habit_completion` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`habit_id` integer NOT NULL,
	`todoist_task_id` text,
	`completed_at_utc` text NOT NULL,
	`completed_local_date` text NOT NULL,
	`source` text NOT NULL,
	`created_at_utc` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `habit_completion_habit_date_idx`
ON `habit_completion` (`habit_id`, `completed_local_date`);
--> statement-breakpoint
CREATE INDEX `habit_completion_task_idx`
ON `habit_completion` (`todoist_task_id`, `completed_at_utc`);
--> statement-breakpoint
CREATE INDEX `habit_completion_local_date_idx`
ON `habit_completion` (`completed_local_date`, `completed_at_utc`);
--> statement-breakpoint
INSERT INTO `habit` (
  `todoist_task_id`,
  `title`,
  `normalized_title`,
  `is_active`,
  `project_id`,
  `project_name`,
  `todoist_url`,
  `raw_recurrence_text`,
  `schedule_kind`,
  `schedule_json`
)
SELECT
  `todoist_task_id`,
  `last_seen_content`,
  `normalized_title`,
  CASE WHEN `task_status` = 'deleted' THEN false ELSE true END,
  `last_seen_project_id`,
  `last_seen_project_name`,
  `last_seen_url`,
  `last_seen_due_string`,
  CASE
    WHEN `last_seen_recurring` = true THEN 'unparsed'
    ELSE 'unparsed'
  END,
  '{}'
FROM `todoist_task_map`
WHERE `last_seen_labels_csv` IS NOT NULL
  AND instr(',' || `last_seen_labels_csv` || ',', ',habit,') > 0
ON CONFLICT(`todoist_task_id`) DO NOTHING;
--> statement-breakpoint
INSERT INTO `habit` (
  `todoist_task_id`,
  `title`,
  `normalized_title`,
  `is_active`,
  `project_id`,
  `project_name`,
  `todoist_url`,
  `schedule_kind`,
  `schedule_json`
)
SELECT
  `todoist_task_id`,
  `title`,
  `normalized_title`,
  false,
  `project_id`,
  `project_name`,
  `url`,
  'unparsed',
  '{}'
FROM `habit_completion_history`
WHERE `todoist_task_id` NOT IN (
  SELECT `todoist_task_id`
  FROM `habit`
  WHERE `todoist_task_id` IS NOT NULL
)
GROUP BY `todoist_task_id`, `title`, `normalized_title`, `project_id`, `project_name`, `url`;
--> statement-breakpoint
INSERT INTO `habit_completion` (
  `habit_id`,
  `todoist_task_id`,
  `completed_at_utc`,
  `completed_local_date`,
  `source`
)
SELECT
  `habit`.`id`,
  `habit_completion_history`.`todoist_task_id`,
  `habit_completion_history`.`completed_at_utc`,
  `habit_completion_history`.`completed_local_date`,
  `habit_completion_history`.`source`
FROM `habit_completion_history`
INNER JOIN `habit`
  ON `habit`.`todoist_task_id` = `habit_completion_history`.`todoist_task_id`
ON CONFLICT(`habit_id`, `completed_local_date`) DO NOTHING;
