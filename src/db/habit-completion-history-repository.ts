import { and, asc, desc, eq } from 'drizzle-orm';

import type { HabitCompletionRecord, HabitCompletionRecordInput } from '../domain/habit';
import type { Database } from './types';
import { habitCompletionHistory } from './schema';

export class HabitCompletionHistoryRepository {
  constructor(private readonly db: Database) {}

  async upsert(record: HabitCompletionRecordInput) {
    await this.db
      .insert(habitCompletionHistory)
      .values({
        dedupeKey: record.dedupeKey,
        todoistTaskId: record.todoistTaskId,
        normalizedTitle: record.normalizedTitle,
        title: record.title,
        completedAtUtc: record.completedAtUtc,
        completedLocalDate: record.completedLocalDate,
        source: record.source,
        priority: record.priority,
        projectId: record.projectId ?? null,
        projectName: record.projectName ?? null,
        url: record.url,
      })
      .onConflictDoNothing({
        target: habitCompletionHistory.dedupeKey,
      });
  }

  async listAll(): Promise<HabitCompletionRecord[]> {
    const rows = await this.db.query.habitCompletionHistory.findMany({
      orderBy: [asc(habitCompletionHistory.completedAtUtc)],
    });

    return rows.map(mapRow);
  }

  async listByLocalDate(localDate: string): Promise<HabitCompletionRecord[]> {
    const rows = await this.db.query.habitCompletionHistory.findMany({
      where: eq(habitCompletionHistory.completedLocalDate, localDate),
      orderBy: [desc(habitCompletionHistory.completedAtUtc)],
    });

    return rows.map(mapRow);
  }

  async deleteLatestForTask(todoistTaskId: string) {
    const latest = await this.db.query.habitCompletionHistory.findFirst({
      where: eq(habitCompletionHistory.todoistTaskId, todoistTaskId),
      orderBy: [desc(habitCompletionHistory.completedAtUtc)],
    });

    if (!latest) {
      return;
    }

    await this.db
      .delete(habitCompletionHistory)
      .where(
        and(
          eq(habitCompletionHistory.todoistTaskId, todoistTaskId),
          eq(habitCompletionHistory.dedupeKey, latest.dedupeKey),
        ),
      );
  }
}

function mapRow(row: typeof habitCompletionHistory.$inferSelect): HabitCompletionRecord {
  return {
    dedupeKey: row.dedupeKey,
    todoistTaskId: row.todoistTaskId,
    normalizedTitle: row.normalizedTitle,
    title: row.title,
    completedAtUtc: row.completedAtUtc,
    completedLocalDate: row.completedLocalDate,
    source: row.source as HabitCompletionRecord['source'],
    priority: row.priority,
    projectId: row.projectId ?? undefined,
    projectName: row.projectName ?? undefined,
    url: row.url,
    createdAtUtc: row.createdAtUtc,
  };
}
