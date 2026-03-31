ALTER TABLE `habit` ADD COLUMN `active_status` text DEFAULT 'inactive' NOT NULL;
--> statement-breakpoint
ALTER TABLE `habit` ADD COLUMN `current_due_date` text;
--> statement-breakpoint
ALTER TABLE `habit` ADD COLUMN `current_due_datetime_utc` text;
--> statement-breakpoint
ALTER TABLE `habit` ADD COLUMN `current_due_string` text;
--> statement-breakpoint
UPDATE `habit`
SET `active_status` = CASE
  WHEN `is_active` = false THEN 'inactive'
  WHEN `todoist_task_id` IS NULL THEN 'inactive'
  WHEN `raw_recurrence_text` IS NOT NULL THEN 'future'
  ELSE 'inactive'
END,
`current_due_string` = COALESCE(`current_due_string`, `raw_recurrence_text`);
