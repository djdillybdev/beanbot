import { and, asc, desc, eq, inArray } from 'drizzle-orm';

import type { HabitCompletionRecord, HabitCompletionRecordInput } from '../domain/habit';
import type { Database } from './types';
import { habitCompletion } from './schema';

export class HabitCompletionRepository {
  constructor(private readonly db: Database) {}

  async upsert(record: HabitCompletionRecordInput) {
    await this.db
      .insert(habitCompletion)
      .values({
        habitId: record.habitId,
        todoistTaskId: record.todoistTaskId ?? null,
        completedAtUtc: record.completedAtUtc,
        completedLocalDate: record.completedLocalDate,
        source: record.source,
      })
      .onConflictDoNothing({
        target: [habitCompletion.habitId, habitCompletion.completedLocalDate],
      });
  }

  async listByLocalDate(localDate: string): Promise<HabitCompletionRecord[]> {
    const rows = await this.db.query.habitCompletion.findMany({
      where: eq(habitCompletion.completedLocalDate, localDate),
      orderBy: [desc(habitCompletion.completedAtUtc)],
    });

    return rows.map(mapRow);
  }

  async listForHabit(habitId: number): Promise<HabitCompletionRecord[]> {
    const rows = await this.db.query.habitCompletion.findMany({
      where: eq(habitCompletion.habitId, habitId),
      orderBy: [asc(habitCompletion.completedAtUtc)],
    });

    return rows.map(mapRow);
  }

  async listForHabits(habitIds: number[]): Promise<HabitCompletionRecord[]> {
    if (habitIds.length === 0) {
      return [];
    }

    const rows = await this.db.query.habitCompletion.findMany({
      where: inArray(habitCompletion.habitId, habitIds),
      orderBy: [asc(habitCompletion.completedAtUtc)],
    });

    return rows.map(mapRow);
  }

  async deleteLatestForTask(todoistTaskId: string) {
    const latest = await this.db.query.habitCompletion.findFirst({
      where: eq(habitCompletion.todoistTaskId, todoistTaskId),
      orderBy: [desc(habitCompletion.completedAtUtc)],
    });

    if (!latest) {
      return;
    }

    await this.db
      .delete(habitCompletion)
      .where(
        and(
          eq(habitCompletion.id, latest.id),
          eq(habitCompletion.todoistTaskId, todoistTaskId),
        ),
      );
  }
}

function mapRow(row: typeof habitCompletion.$inferSelect): HabitCompletionRecord {
  return {
    id: row.id,
    habitId: row.habitId,
    todoistTaskId: row.todoistTaskId ?? undefined,
    completedAtUtc: row.completedAtUtc,
    completedLocalDate: row.completedLocalDate,
    source: row.source as HabitCompletionRecord['source'],
    createdAtUtc: row.createdAtUtc,
  };
}
