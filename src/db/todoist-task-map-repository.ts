import { and, desc, eq, like, or, sql } from 'drizzle-orm';

import type { Database } from './types';
import { todoistTaskMap } from './schema';
import type { TodoistTaskRecord } from '../domain/task';

interface TodoistTaskMapRowInput {
  id: string;
  title: string;
  normalizedTitle: string;
  priority: number;
  dueLabel?: string;
  dueDate?: string;
  url: string;
  isActive: boolean;
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
        lastSeenDueLabel: task.dueLabel ?? null,
        lastSeenDueDate: task.dueDate ?? null,
        lastSeenUrl: task.url,
        isActive: task.isActive,
        updatedAtUtc: now,
      })
      .onConflictDoUpdate({
        target: todoistTaskMap.todoistTaskId,
        set: {
          normalizedTitle: task.normalizedTitle,
          lastSeenContent: task.title,
          lastSeenDueLabel: task.dueLabel ?? null,
          lastSeenDueDate: task.dueDate ?? null,
          lastSeenUrl: task.url,
          isActive: task.isActive,
          updatedAtUtc: now,
        },
      });
  }

  async markCompleted(taskId: string) {
    await this.db
      .update(todoistTaskMap)
      .set({
        isActive: false,
        updatedAtUtc: new Date().toISOString(),
      })
      .where(eq(todoistTaskMap.todoistTaskId, taskId));
  }

  async findActiveByNormalizedTitle(normalizedTitle: string): Promise<TodoistTaskRecord[]> {
    const rows = await this.db.query.todoistTaskMap.findMany({
      where: and(
        eq(todoistTaskMap.normalizedTitle, normalizedTitle),
        eq(todoistTaskMap.isActive, true),
      ),
      orderBy: [desc(todoistTaskMap.updatedAtUtc)],
      limit: 10,
    });

    return rows.map((row) => ({
      id: row.todoistTaskId,
      title: row.lastSeenContent,
      normalizedTitle: row.normalizedTitle,
      priority: 0,
      dueLabel: row.lastSeenDueLabel ?? undefined,
      dueDate: row.lastSeenDueDate ?? undefined,
      url: row.lastSeenUrl,
      isActive: row.isActive,
    }));
  }

  async getAutocompleteSuggestions(normalizedQuery: string): Promise<TodoistTaskRecord[]> {
    const query = normalizedQuery.trim();

    const rows = await this.db.query.todoistTaskMap.findMany({
      where:
        query.length === 0
          ? eq(todoistTaskMap.isActive, true)
          : and(
              eq(todoistTaskMap.isActive, true),
              or(
                like(todoistTaskMap.normalizedTitle, `${escapeLike(query)}%`),
                like(todoistTaskMap.normalizedTitle, `%${escapeLike(query)}%`),
              ),
            ),
      orderBy: [
        sql`CASE WHEN ${todoistTaskMap.normalizedTitle} LIKE ${`${escapeLike(query)}%`} ESCAPE '\\' THEN 0 ELSE 1 END`,
        desc(todoistTaskMap.updatedAtUtc),
      ],
      limit: 25,
    });

    return rows.map((row) => ({
      id: row.todoistTaskId,
      title: row.lastSeenContent,
      normalizedTitle: row.normalizedTitle,
      priority: 0,
      dueLabel: row.lastSeenDueLabel ?? undefined,
      dueDate: row.lastSeenDueDate ?? undefined,
      url: row.lastSeenUrl,
      isActive: row.isActive,
    }));
  }

  async findActiveById(taskId: string): Promise<TodoistTaskRecord | null> {
    const row = await this.db.query.todoistTaskMap.findFirst({
      where: and(eq(todoistTaskMap.todoistTaskId, taskId), eq(todoistTaskMap.isActive, true)),
    });

    if (!row) {
      return null;
    }

    return {
      id: row.todoistTaskId,
      title: row.lastSeenContent,
      normalizedTitle: row.normalizedTitle,
      priority: 0,
      dueLabel: row.lastSeenDueLabel ?? undefined,
      dueDate: row.lastSeenDueDate ?? undefined,
      url: row.lastSeenUrl,
      isActive: row.isActive,
    };
  }
}

function escapeLike(value: string) {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}
