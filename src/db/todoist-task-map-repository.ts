import { and, desc, eq, inArray, like, or } from 'drizzle-orm';

import type { Database } from './types';
import { todoistTaskMap } from './schema';
import type { TaskStatus, TodoistTaskRecord } from '../domain/task';

interface TodoistTaskMapRowInput {
  id: string;
  title: string;
  normalizedTitle: string;
  priority: number;
  projectId?: string;
  projectName?: string;
  dueLabel?: string;
  dueDate?: string;
  dueDateTimeUtc?: string;
  dueString?: string;
  labels?: string[];
  url: string;
  taskStatus: TaskStatus;
}

export class TodoistTaskMapRepository {
  constructor(private readonly db: Database) {}

  async upsert(task: TodoistTaskMapRowInput) {
    const now = new Date().toISOString();

    await this.db
      .insert(todoistTaskMap)
      .values({
        todoistTaskId: task.id,
        normalizedTitle: task.normalizedTitle,
        lastSeenContent: task.title,
        lastSeenPriority: task.priority,
        lastSeenProjectId: task.projectId ?? null,
        lastSeenProjectName: task.projectName ?? null,
        lastSeenDueLabel: task.dueLabel ?? null,
        lastSeenDueDate: task.dueDate ?? null,
        lastSeenDueDatetimeUtc: task.dueDateTimeUtc ?? null,
        lastSeenDueString: task.dueString ?? null,
        lastSeenLabelsCsv: serializeLabels(task.labels),
        lastSeenUrl: task.url,
        taskStatus: task.taskStatus,
        isActive: task.taskStatus === 'active',
        updatedAtUtc: now,
      })
      .onConflictDoUpdate({
        target: todoistTaskMap.todoistTaskId,
        set: {
          normalizedTitle: task.normalizedTitle,
          lastSeenContent: task.title,
          lastSeenPriority: task.priority,
          lastSeenProjectId: task.projectId ?? null,
          lastSeenProjectName: task.projectName ?? null,
          lastSeenDueLabel: task.dueLabel ?? null,
          lastSeenDueDate: task.dueDate ?? null,
          lastSeenDueDatetimeUtc: task.dueDateTimeUtc ?? null,
          lastSeenDueString: task.dueString ?? null,
          lastSeenLabelsCsv: serializeLabels(task.labels),
          lastSeenUrl: task.url,
          taskStatus: task.taskStatus,
          isActive: task.taskStatus === 'active',
          updatedAtUtc: now,
        },
      });
  }

  async updateStatus(taskId: string, taskStatus: TaskStatus) {
    await this.db
      .update(todoistTaskMap)
      .set({
        taskStatus,
        isActive: taskStatus === 'active',
        updatedAtUtc: new Date().toISOString(),
      })
      .where(eq(todoistTaskMap.todoistTaskId, taskId));
  }

  async findActiveByNormalizedTitle(normalizedTitle: string): Promise<TodoistTaskRecord[]> {
    const rows = await this.db.query.todoistTaskMap.findMany({
      where: and(
        eq(todoistTaskMap.normalizedTitle, normalizedTitle),
        eq(todoistTaskMap.taskStatus, 'active'),
      ),
      orderBy: [desc(todoistTaskMap.updatedAtUtc)],
      limit: 10,
    });

    return rows.map(mapRowToTaskRecord);
  }

  async getAutocompleteCandidates(
    normalizedQuery: string,
    statuses: TaskStatus[],
  ): Promise<TodoistTaskRecord[]> {
    const query = normalizedQuery.trim();

    const rows = await this.db.query.todoistTaskMap.findMany({
      where:
        query.length === 0
          ? inArray(todoistTaskMap.taskStatus, statuses)
          : and(
              inArray(todoistTaskMap.taskStatus, statuses),
              or(
                like(todoistTaskMap.normalizedTitle, `${escapeLike(query)}%`),
                like(todoistTaskMap.normalizedTitle, `%${escapeLike(query)}%`),
              ),
            ),
      orderBy: [desc(todoistTaskMap.updatedAtUtc)],
      limit: 50,
    });

    return rows.map(mapRowToTaskRecord);
  }

  async findById(taskId: string, statuses?: TaskStatus[]): Promise<TodoistTaskRecord | null> {
    const row = await this.db.query.todoistTaskMap.findFirst({
      where: statuses
        ? and(eq(todoistTaskMap.todoistTaskId, taskId), inArray(todoistTaskMap.taskStatus, statuses))
        : eq(todoistTaskMap.todoistTaskId, taskId),
    });

    return row ? mapRowToTaskRecord(row) : null;
  }

  async findByIds(taskIds: string[]): Promise<TodoistTaskRecord[]> {
    if (taskIds.length === 0) {
      return [];
    }

    const rows = await this.db.query.todoistTaskMap.findMany({
      where: inArray(todoistTaskMap.todoistTaskId, taskIds),
      limit: taskIds.length,
    });

    return rows.map(mapRowToTaskRecord);
  }

  async listByLabel(label: string, statuses?: TaskStatus[]): Promise<Array<TodoistTaskRecord & { updatedAtUtc: string }>> {
    const rows = await this.db.query.todoistTaskMap.findMany({
      where: statuses
        ? and(
            inArray(todoistTaskMap.taskStatus, statuses),
            like(todoistTaskMap.lastSeenLabelsCsv, `%${escapeLike(label)}%`),
          )
        : like(todoistTaskMap.lastSeenLabelsCsv, `%${escapeLike(label)}%`),
      orderBy: [desc(todoistTaskMap.updatedAtUtc)],
      limit: 500,
    });

    return rows
      .filter((row) => deserializeLabels(row.lastSeenLabelsCsv)?.includes(label))
      .map((row) => ({
        ...mapRowToTaskRecord(row),
        updatedAtUtc: row.updatedAtUtc,
      }));
  }
}

function mapRowToTaskRecord(row: typeof todoistTaskMap.$inferSelect): TodoistTaskRecord {
  return {
    id: row.todoistTaskId,
    title: row.lastSeenContent,
    normalizedTitle: row.normalizedTitle,
    priority: row.lastSeenPriority,
    projectId: row.lastSeenProjectId ?? undefined,
    projectName: row.lastSeenProjectName ?? undefined,
    dueLabel: row.lastSeenDueLabel ?? undefined,
    dueDate: row.lastSeenDueDate ?? undefined,
    dueDateTimeUtc: row.lastSeenDueDatetimeUtc ?? undefined,
    dueString: row.lastSeenDueString ?? undefined,
    labels: deserializeLabels(row.lastSeenLabelsCsv),
    url: row.lastSeenUrl,
    taskStatus: row.taskStatus as TaskStatus,
  };
}

function serializeLabels(labels?: string[]) {
  return labels && labels.length > 0 ? labels.join(',') : null;
}

function deserializeLabels(labelsCsv?: string | null) {
  return labelsCsv ? labelsCsv.split(',').filter((label) => label.length > 0) : undefined;
}

function escapeLike(value: string) {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}
