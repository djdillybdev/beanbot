import { and, asc, desc, eq } from 'drizzle-orm';

import type { TaskCompletionRecord, TaskCompletionSource, TodoistTaskRecord } from '../domain/task';
import type { CompletedTaskSummary } from '../domain/daily-review';
import type { Database } from './types';
import { taskCompletion } from './schema';
import { getLocalDateParts } from '../utils/time';
import { normalizeTaskTitle } from '../utils/text';

type CompletionSnapshot = Pick<
  TodoistTaskRecord,
  | 'id'
  | 'title'
  | 'normalizedTitle'
  | 'priority'
  | 'projectId'
  | 'projectName'
  | 'recurring'
  | 'dueDate'
  | 'dueDateTimeUtc'
  | 'dueString'
  | 'labels'
  | 'url'
> | Pick<
  CompletedTaskSummary,
  | 'id'
  | 'title'
  | 'normalizedTitle'
  | 'priority'
  | 'projectId'
  | 'projectName'
  | 'recurring'
  | 'dueDate'
  | 'dueDateTimeUtc'
  | 'dueString'
  | 'labels'
  | 'url'
>;

export class TaskCompletionRepository {
  constructor(private readonly db: Database) {}

  async recordBotCompletion(task: CompletionSnapshot, completedAtUtc: string, timezone: string) {
    const completedLocalDate = getLocalDateParts(new Date(completedAtUtc), timezone).date;

    await this.db
      .insert(taskCompletion)
      .values(buildInsertValues(task, {
        eventKey: buildBotEventKey(task.id, completedAtUtc),
        completedAtUtc,
        completedLocalDate,
        source: 'bot',
        provisional: true,
      }))
      .onConflictDoNothing({
        target: taskCompletion.eventKey,
      });
  }

  async recordExternalCompletion(task: CompletionSnapshot, completedAtUtc: string, timezone: string) {
    const completedLocalDate = getLocalDateParts(new Date(completedAtUtc), timezone).date;
    const provisional = await this.db.query.taskCompletion.findFirst({
      where: and(
        eq(taskCompletion.todoistTaskId, task.id),
        eq(taskCompletion.completedLocalDate, completedLocalDate),
        eq(taskCompletion.provisional, true),
      ),
      orderBy: [desc(taskCompletion.completedAtUtc)],
    });

    if (provisional) {
      await this.db
        .delete(taskCompletion)
        .where(eq(taskCompletion.eventKey, provisional.eventKey));
    }

    await this.db
      .insert(taskCompletion)
      .values(buildInsertValues(task, {
        eventKey: buildExternalEventKey(task.id, completedAtUtc),
        completedAtUtc,
        completedLocalDate,
        source: 'todoist_external',
        provisional: false,
      }))
      .onConflictDoNothing({
        target: taskCompletion.eventKey,
      });
  }

  async listByLocalDate(localDate: string): Promise<TaskCompletionRecord[]> {
    const rows = await this.db.query.taskCompletion.findMany({
      where: eq(taskCompletion.completedLocalDate, localDate),
      orderBy: [desc(taskCompletion.completedAtUtc)],
    });

    return rows.map(mapRow);
  }

  async listForTask(todoistTaskId: string): Promise<TaskCompletionRecord[]> {
    const rows = await this.db.query.taskCompletion.findMany({
      where: eq(taskCompletion.todoistTaskId, todoistTaskId),
      orderBy: [asc(taskCompletion.completedAtUtc)],
    });

    return rows.map(mapRow);
  }

  async deleteLatestForTask(todoistTaskId: string) {
    const latest = await this.db.query.taskCompletion.findFirst({
      where: eq(taskCompletion.todoistTaskId, todoistTaskId),
      orderBy: [desc(taskCompletion.completedAtUtc)],
    });

    if (!latest) {
      return;
    }

    await this.db
      .delete(taskCompletion)
      .where(eq(taskCompletion.eventKey, latest.eventKey));
  }
}

function buildInsertValues(
  task: CompletionSnapshot,
  input: {
    eventKey: string;
    completedAtUtc: string;
    completedLocalDate: string;
    source: TaskCompletionSource;
    provisional: boolean;
  },
) {
  return {
    eventKey: input.eventKey,
    todoistTaskId: task.id,
    normalizedTitle: task.normalizedTitle ?? normalizeTaskTitle(task.title),
    title: task.title,
    completedAtUtc: input.completedAtUtc,
    completedLocalDate: input.completedLocalDate,
    source: input.source,
    priority: task.priority,
    projectId: task.projectId ?? null,
    projectName: task.projectName ?? null,
    recurring: task.recurring ?? false,
    dueDate: task.dueDate ?? null,
    dueDatetimeUtc: task.dueDateTimeUtc ?? null,
    dueString: task.dueString ?? null,
    labelsCsv: serializeLabels(task.labels),
    url: task.url,
    provisional: input.provisional,
  };
}

function mapRow(row: typeof taskCompletion.$inferSelect): TaskCompletionRecord {
  return {
    eventKey: row.eventKey,
    todoistTaskId: row.todoistTaskId,
    normalizedTitle: row.normalizedTitle,
    title: row.title,
    priority: row.priority,
    projectId: row.projectId ?? undefined,
    projectName: row.projectName ?? undefined,
    completedAtUtc: row.completedAtUtc,
    completedLocalDate: row.completedLocalDate,
    source: row.source as TaskCompletionSource,
    recurring: row.recurring,
    dueDate: row.dueDate ?? undefined,
    dueDateTimeUtc: row.dueDatetimeUtc ?? undefined,
    dueString: row.dueString ?? undefined,
    labels: deserializeLabels(row.labelsCsv),
    url: row.url,
    provisional: row.provisional,
    createdAtUtc: row.createdAtUtc,
  };
}

function buildBotEventKey(todoistTaskId: string, completedAtUtc: string) {
  return `bot:${todoistTaskId}:${completedAtUtc}`;
}

function buildExternalEventKey(todoistTaskId: string, completedAtUtc: string) {
  return `todoist_external:${todoistTaskId}:${completedAtUtc}`;
}

function serializeLabels(labels?: string[]) {
  return labels && labels.length > 0 ? labels.join(',') : null;
}

function deserializeLabels(labelsCsv?: string | null) {
  return labelsCsv ? labelsCsv.split(',').filter((label) => label.length > 0) : undefined;
}
