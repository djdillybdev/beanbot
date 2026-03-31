import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';

import type { AppConfig } from '../config';

export interface MigrationRunResult {
  verification: {
    issuesDetected: string[];
    issuesRemaining: string[];
  };
  repairsApplied: string[];
  databasePath: string;
}

export function runMigrations(config: AppConfig): MigrationRunResult {
  const sqlite = new Database(config.databasePath, { create: true });
  const db = drizzle(sqlite);
  migrate(db, {
    migrationsFolder: './drizzle',
  });
  const repairsApplied: string[] = [];
  const issuesDetected = collectSchemaIssues(sqlite);

  if (issuesDetected.length > 0) {
    ensureObsidianSyncSchema(sqlite, repairsApplied);
    ensureHabitSchema(sqlite, repairsApplied);
  }

  const issuesRemaining = collectSchemaIssues(sqlite);
  sqlite.close();

  if (issuesRemaining.length > 0) {
    throw new Error(`Schema verification failed:\n- ${issuesRemaining.join('\n- ')}`);
  }

  return {
    verification: {
      issuesDetected,
      issuesRemaining,
    },
    repairsApplied,
    databasePath: config.databasePath,
  };
}

export function inspectMigrationHealth(config: AppConfig) {
  const sqlite = new Database(config.databasePath, { create: true });
  const issues = collectSchemaIssues(sqlite);
  sqlite.close();

  return {
    databasePath: config.databasePath,
    status: issues.length === 0 ? 'healthy' : 'degraded',
    issues,
  };
}

function ensureObsidianSyncSchema(sqlite: Database, repairsApplied: string[]) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS "obsidian_task" (
      "todoist_task_id" text PRIMARY KEY NOT NULL,
      "content" text NOT NULL,
      "completed" integer DEFAULT false NOT NULL,
      "priority_api" integer DEFAULT 1 NOT NULL,
      "project" text,
      "effort" text,
      "todoist_project_id" text,
      "todoist_project_name" text,
      "section_id" text,
      "section_name" text,
      "due_date" text,
      "due_datetime_utc" text,
      "recurring" integer DEFAULT false NOT NULL,
      "parent_id" text,
      "order_index" integer,
      "todoist_url" text NOT NULL,
      "created_at_utc" text,
      "source_updated_at_utc" text,
      "db_updated_at_utc" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      "last_synced_at_utc" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      "sync_status" text DEFAULT 'synced' NOT NULL,
      "source_of_last_change" text DEFAULT 'todoist' NOT NULL,
      "content_hash" text,
      "note_body" text,
      "task_status" text DEFAULT 'active' NOT NULL
    );

    CREATE INDEX IF NOT EXISTS "obsidian_task_status_updated_idx"
    ON "obsidian_task" ("task_status", "db_updated_at_utc");

    CREATE INDEX IF NOT EXISTS "obsidian_task_sync_status_idx"
    ON "obsidian_task" ("sync_status");

    CREATE TABLE IF NOT EXISTS "obsidian_task_label" (
      "todoist_task_id" text NOT NULL,
      "label_name" text NOT NULL,
      "created_at_utc" text DEFAULT CURRENT_TIMESTAMP NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS "obsidian_task_label_task_label_idx"
    ON "obsidian_task_label" ("todoist_task_id", "label_name");

    CREATE INDEX IF NOT EXISTS "obsidian_task_label_name_idx"
    ON "obsidian_task_label" ("label_name");

    CREATE TABLE IF NOT EXISTS "obsidian_note_index" (
      "todoist_task_id" text PRIMARY KEY NOT NULL,
      "file_path" text NOT NULL,
      "content_hash" text NOT NULL,
      "metadata_hash" text NOT NULL,
      "last_file_mtime_utc" text,
      "last_imported_at_utc" text,
      "last_exported_at_utc" text DEFAULT CURRENT_TIMESTAMP NOT NULL
    );

    CREATE TABLE IF NOT EXISTS "obsidian_sync_state" (
      "sync_key" text PRIMARY KEY NOT NULL,
      "last_full_sync_at_utc" text,
      "last_incremental_sync_at_utc" text,
      "last_incremental_cursor" text,
      "last_vault_scan_at_utc" text,
      "updated_at_utc" text DEFAULT CURRENT_TIMESTAMP NOT NULL
    );

    CREATE TABLE IF NOT EXISTS "obsidian_sync_event" (
      "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      "event_type" text NOT NULL,
      "source" text NOT NULL,
      "todoist_task_id" text,
      "payload_summary" text,
      "result" text,
      "created_at_utc" text DEFAULT CURRENT_TIMESTAMP NOT NULL
    );

    CREATE INDEX IF NOT EXISTS "obsidian_sync_event_source_created_idx"
    ON "obsidian_sync_event" ("source", "created_at_utc");

    CREATE INDEX IF NOT EXISTS "obsidian_sync_event_task_created_idx"
    ON "obsidian_sync_event" ("todoist_task_id", "created_at_utc");
  `);

  const columns = sqlite
    .query(`PRAGMA table_info("obsidian_task")`)
    .all() as Array<{ name: string }>;

  if (!columns.some((column) => column.name === 'effort')) {
    sqlite.exec(`ALTER TABLE "obsidian_task" ADD COLUMN "effort" text;`);
    repairsApplied.push('Added obsidian_task.effort compatibility column.');
  }
}

function ensureHabitSchema(sqlite: Database, repairsApplied: string[]) {
  const initialRepairCount = repairsApplied.length;

  if (!hasColumn(sqlite, 'todoist_task_map', 'last_seen_recurring')) {
    sqlite.exec(`ALTER TABLE "todoist_task_map" ADD COLUMN "last_seen_recurring" integer DEFAULT false NOT NULL;`);
    repairsApplied.push('Added todoist_task_map.last_seen_recurring compatibility column.');
  }

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS "habit" (
      "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      "todoist_task_id" text,
      "title" text NOT NULL,
      "normalized_title" text NOT NULL,
      "is_active" integer DEFAULT true NOT NULL,
      "active_status" text DEFAULT 'inactive' NOT NULL,
      "project_id" text,
      "project_name" text,
      "todoist_url" text,
      "raw_recurrence_text" text,
      "current_due_date" text,
      "current_due_datetime_utc" text,
      "current_due_string" text,
      "schedule_kind" text DEFAULT 'unparsed' NOT NULL,
      "schedule_json" text DEFAULT '{}' NOT NULL,
      "current_streak" integer DEFAULT 0 NOT NULL,
      "longest_streak" integer DEFAULT 0 NOT NULL,
      "last_completed_local_date" text,
      "completion_count" integer DEFAULT 0 NOT NULL,
      "streak_updated_at_utc" text,
      "created_at_utc" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      "updated_at_utc" text DEFAULT CURRENT_TIMESTAMP NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS "habit_todoist_task_id_idx"
    ON "habit" ("todoist_task_id");

    CREATE INDEX IF NOT EXISTS "habit_active_idx"
    ON "habit" ("is_active", "updated_at_utc");

    CREATE INDEX IF NOT EXISTS "habit_normalized_title_idx"
    ON "habit" ("normalized_title");

    CREATE TABLE IF NOT EXISTS "habit_completion" (
      "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      "habit_id" integer NOT NULL,
      "todoist_task_id" text,
      "completed_at_utc" text NOT NULL,
      "completed_local_date" text NOT NULL,
      "source" text NOT NULL,
      "created_at_utc" text DEFAULT CURRENT_TIMESTAMP NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS "habit_completion_habit_date_idx"
    ON "habit_completion" ("habit_id", "completed_local_date");

    CREATE INDEX IF NOT EXISTS "habit_completion_task_idx"
    ON "habit_completion" ("todoist_task_id", "completed_at_utc");

    CREATE INDEX IF NOT EXISTS "habit_completion_local_date_idx"
    ON "habit_completion" ("completed_local_date", "completed_at_utc");
  `);

  ensureHabitColumn(
    sqlite,
    'active_status',
    `ALTER TABLE "habit" ADD COLUMN "active_status" text DEFAULT 'inactive' NOT NULL;`,
    repairsApplied,
  );
  ensureHabitColumn(
    sqlite,
    'current_due_date',
    `ALTER TABLE "habit" ADD COLUMN "current_due_date" text;`,
    repairsApplied,
  );
  ensureHabitColumn(
    sqlite,
    'current_due_datetime_utc',
    `ALTER TABLE "habit" ADD COLUMN "current_due_datetime_utc" text;`,
    repairsApplied,
  );
  ensureHabitColumn(
    sqlite,
    'current_due_string',
    `ALTER TABLE "habit" ADD COLUMN "current_due_string" text;`,
    repairsApplied,
  );

  sqlite.exec(`
    INSERT INTO "habit" (
      "todoist_task_id",
      "title",
      "normalized_title",
      "is_active",
      "project_id",
      "project_name",
      "todoist_url",
      "raw_recurrence_text",
      "current_due_date",
      "current_due_datetime_utc",
      "current_due_string",
      "schedule_kind",
      "schedule_json"
    )
    SELECT
      "todoist_task_id",
      "last_seen_content",
      "normalized_title",
      CASE WHEN "task_status" = 'deleted' THEN false ELSE true END,
      "last_seen_project_id",
      "last_seen_project_name",
      "last_seen_url",
      "last_seen_due_string",
      "last_seen_due_date",
      "last_seen_due_datetime_utc",
      "last_seen_due_string",
      'unparsed',
      '{}'
    FROM "todoist_task_map"
    WHERE "last_seen_labels_csv" IS NOT NULL
      AND instr(',' || "last_seen_labels_csv" || ',', ',habit,') > 0
    ON CONFLICT("todoist_task_id") DO NOTHING;

    INSERT INTO "habit" (
      "todoist_task_id",
      "title",
      "normalized_title",
      "is_active",
      "project_id",
      "project_name",
      "todoist_url",
      "schedule_kind",
      "schedule_json"
    )
    SELECT
      "todoist_task_id",
      "title",
      "normalized_title",
      false,
      "project_id",
      "project_name",
      "url",
      'unparsed',
      '{}'
    FROM "habit_completion_history"
    WHERE "todoist_task_id" NOT IN (
      SELECT "todoist_task_id"
      FROM "habit"
      WHERE "todoist_task_id" IS NOT NULL
    )
    GROUP BY "todoist_task_id", "title", "normalized_title", "project_id", "project_name", "url";

    INSERT INTO "habit_completion" (
      "habit_id",
      "todoist_task_id",
      "completed_at_utc",
      "completed_local_date",
      "source"
    )
    SELECT
      "habit"."id",
      "habit_completion_history"."todoist_task_id",
      "habit_completion_history"."completed_at_utc",
      "habit_completion_history"."completed_local_date",
      "habit_completion_history"."source"
    FROM "habit_completion_history"
    INNER JOIN "habit"
      ON "habit"."todoist_task_id" = "habit_completion_history"."todoist_task_id"
    ON CONFLICT("habit_id", "completed_local_date") DO NOTHING;

    UPDATE "habit"
    SET "active_status" = CASE
      WHEN "is_active" = false THEN 'inactive'
      WHEN "todoist_task_id" IS NULL THEN 'inactive'
      WHEN "raw_recurrence_text" IS NOT NULL THEN 'future'
      ELSE 'inactive'
    END,
    "current_due_string" = COALESCE("current_due_string", "raw_recurrence_text")
    WHERE "active_status" IS NULL
      OR "active_status" = ''
      OR "current_due_string" IS NULL;
  `);

  if (repairsApplied.length > initialRepairCount) {
    repairsApplied.push('Replayed habit compatibility backfill statements.');
  }
}

function ensureHabitColumn(
  sqlite: Database,
  columnName: string,
  alterSql: string,
  repairsApplied: string[],
) {
  if (!hasColumn(sqlite, 'habit', columnName)) {
    sqlite.exec(alterSql);
    repairsApplied.push(`Added habit.${columnName} compatibility column.`);
  }
}

function collectSchemaIssues(sqlite: Database) {
  const issues: string[] = [];

  if (!hasTable(sqlite, 'obsidian_task')) {
    issues.push('Missing table obsidian_task');
  }

  if (hasTable(sqlite, 'obsidian_task') && !hasColumn(sqlite, 'obsidian_task', 'effort')) {
    issues.push('Missing column obsidian_task.effort');
  }

  if (!hasTable(sqlite, 'habit')) {
    issues.push('Missing table habit');
  }

  if (!hasTable(sqlite, 'habit_completion')) {
    issues.push('Missing table habit_completion');
  }

  if (hasTable(sqlite, 'habit') && !hasColumn(sqlite, 'habit', 'active_status')) {
    issues.push('Missing column habit.active_status');
  }

  if (hasTable(sqlite, 'habit') && !hasColumn(sqlite, 'habit', 'current_due_string')) {
    issues.push('Missing column habit.current_due_string');
  }

  if (!hasColumn(sqlite, 'todoist_task_map', 'last_seen_recurring')) {
    issues.push('Missing column todoist_task_map.last_seen_recurring');
  }

  return issues;
}

function hasTable(sqlite: Database, tableName: string) {
  const rows = sqlite
    .query(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .all(tableName) as Array<{ name: string }>;

  return rows.length > 0;
}

function hasColumn(sqlite: Database, tableName: string, columnName: string) {
  const columns = sqlite
    .query(`PRAGMA table_info("${tableName}")`)
    .all() as Array<{ name: string }>;

  return columns.some((column) => column.name === columnName);
}
