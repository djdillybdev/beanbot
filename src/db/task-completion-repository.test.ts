import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';

import { TaskCompletionRepository } from './task-completion-repository';
import * as schema from './schema';

describe('task completion repository', () => {
  test('stores multiple bot completion events for the same task on the same local date', async () => {
    const sqlite = new Database(':memory:');
    sqlite.exec(`
      CREATE TABLE "task_completion" (
        "event_key" text PRIMARY KEY NOT NULL,
        "todoist_task_id" text NOT NULL,
        "normalized_title" text NOT NULL,
        "title" text NOT NULL,
        "completed_at_utc" text NOT NULL,
        "completed_local_date" text NOT NULL,
        "source" text NOT NULL,
        "priority" integer DEFAULT 1 NOT NULL,
        "project_id" text,
        "project_name" text,
        "recurring" integer DEFAULT false NOT NULL,
        "due_date" text,
        "due_datetime_utc" text,
        "due_string" text,
        "labels_csv" text,
        "url" text NOT NULL,
        "provisional" integer DEFAULT false NOT NULL,
        "created_at_utc" text DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
      CREATE INDEX "task_completion_task_idx" ON "task_completion" ("todoist_task_id", "completed_at_utc");
      CREATE INDEX "task_completion_local_date_idx" ON "task_completion" ("completed_local_date", "completed_at_utc");
      CREATE INDEX "task_completion_task_local_date_idx" ON "task_completion" ("todoist_task_id", "completed_local_date", "provisional");
    `);

    const db = drizzle(sqlite, { schema });
    const repository = new TaskCompletionRepository(db);
    const task = {
      id: 'task-1',
      title: 'Walk',
      normalizedTitle: 'walk',
      priority: 1,
      recurring: true,
      labels: ['habit'],
      url: 'https://todoist.test/task-1',
    };

    await repository.recordBotCompletion(task, '2026-04-08T08:00:00.000Z', 'UTC');
    await repository.recordBotCompletion(task, '2026-04-08T09:00:00.000Z', 'UTC');

    const completions = await repository.listForTask('task-1');

    expect(completions).toHaveLength(2);
    expect(completions.map((completion) => completion.completedAtUtc)).toEqual([
      '2026-04-08T08:00:00.000Z',
      '2026-04-08T09:00:00.000Z',
    ]);

    sqlite.close();
  });

  test('replaces a provisional bot completion with the external Todoist completion for the same local date', async () => {
    const sqlite = new Database(':memory:');
    sqlite.exec(`
      CREATE TABLE "task_completion" (
        "event_key" text PRIMARY KEY NOT NULL,
        "todoist_task_id" text NOT NULL,
        "normalized_title" text NOT NULL,
        "title" text NOT NULL,
        "completed_at_utc" text NOT NULL,
        "completed_local_date" text NOT NULL,
        "source" text NOT NULL,
        "priority" integer DEFAULT 1 NOT NULL,
        "project_id" text,
        "project_name" text,
        "recurring" integer DEFAULT false NOT NULL,
        "due_date" text,
        "due_datetime_utc" text,
        "due_string" text,
        "labels_csv" text,
        "url" text NOT NULL,
        "provisional" integer DEFAULT false NOT NULL,
        "created_at_utc" text DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
      CREATE INDEX "task_completion_task_idx" ON "task_completion" ("todoist_task_id", "completed_at_utc");
      CREATE INDEX "task_completion_local_date_idx" ON "task_completion" ("completed_local_date", "completed_at_utc");
      CREATE INDEX "task_completion_task_local_date_idx" ON "task_completion" ("todoist_task_id", "completed_local_date", "provisional");
    `);

    const db = drizzle(sqlite, { schema });
    const repository = new TaskCompletionRepository(db);
    const task = {
      id: 'task-1',
      title: 'Walk',
      normalizedTitle: 'walk',
      priority: 1,
      recurring: true,
      labels: ['habit'],
      url: 'https://todoist.test/task-1',
    };

    await repository.recordBotCompletion(task, '2026-04-08T08:00:00.000Z', 'UTC');
    await repository.recordBotCompletion(task, '2026-04-08T09:00:00.000Z', 'UTC');
    await repository.recordExternalCompletion(task, '2026-04-08T08:05:00.000Z', 'UTC');

    const completions = await repository.listForTask('task-1');

    expect(completions).toHaveLength(2);
    expect(completions.map((completion) => completion.source)).toEqual(['bot', 'todoist_external']);
    expect(completions.map((completion) => completion.completedAtUtc)).toEqual([
      '2026-04-08T08:00:00.000Z',
      '2026-04-08T08:05:00.000Z',
    ]);
    expect(completions[0]?.provisional).toBe(true);
    expect(completions[1]?.provisional).toBe(false);

    sqlite.close();
  });
});
