import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';

import type { AppConfig } from '../config';

export function runMigrations(config: AppConfig) {
  const sqlite = new Database(config.databasePath, { create: true });
  const db = drizzle(sqlite);
  migrate(db, {
    migrationsFolder: './drizzle',
  });
  ensureObsidianSyncSchema(sqlite);
  sqlite.close();
}

function ensureObsidianSyncSchema(sqlite: Database) {
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
  }
}
