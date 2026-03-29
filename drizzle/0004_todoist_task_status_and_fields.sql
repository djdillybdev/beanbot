ALTER TABLE `todoist_task_map` ADD `last_seen_priority` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `todoist_task_map` ADD `last_seen_due_string` text;
--> statement-breakpoint
ALTER TABLE `todoist_task_map` ADD `last_seen_labels_csv` text;
--> statement-breakpoint
ALTER TABLE `todoist_task_map` ADD `task_status` text DEFAULT 'active' NOT NULL;
--> statement-breakpoint
UPDATE `todoist_task_map`
SET `task_status` = CASE
  WHEN `is_active` = 1 THEN 'active'
  ELSE 'completed'
END;
