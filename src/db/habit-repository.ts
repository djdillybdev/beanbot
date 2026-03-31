import { asc, eq } from 'drizzle-orm';

import type { HabitMetrics, HabitRecord, HabitRecordInput, HabitSchedule } from '../domain/habit';
import type { Database } from './types';
import { habit } from './schema';

export class HabitRepository {
  constructor(private readonly db: Database) {}

  async upsert(input: HabitRecordInput): Promise<HabitRecord> {
    const now = new Date().toISOString();

    if (input.todoistTaskId) {
      await this.db
        .insert(habit)
        .values({
          todoistTaskId: input.todoistTaskId,
          title: input.title,
          normalizedTitle: input.normalizedTitle,
          isActive: input.isActive,
          activeStatus: input.activeStatus,
          projectId: input.projectId ?? null,
          projectName: input.projectName ?? null,
          todoistUrl: input.todoistUrl ?? null,
          rawRecurrenceText: input.rawRecurrenceText ?? null,
          currentDueDate: input.currentDueDate ?? null,
          currentDueDatetimeUtc: input.currentDueDatetimeUtc ?? null,
          currentDueString: input.currentDueString ?? null,
          scheduleKind: input.schedule.kind,
          scheduleJson: JSON.stringify(input.schedule),
          updatedAtUtc: now,
        })
        .onConflictDoUpdate({
          target: habit.todoistTaskId,
          set: {
            title: input.title,
            normalizedTitle: input.normalizedTitle,
            isActive: input.isActive,
            activeStatus: input.activeStatus,
            projectId: input.projectId ?? null,
            projectName: input.projectName ?? null,
            todoistUrl: input.todoistUrl ?? null,
            rawRecurrenceText: input.rawRecurrenceText ?? null,
            currentDueDate: input.currentDueDate ?? null,
            currentDueDatetimeUtc: input.currentDueDatetimeUtc ?? null,
            currentDueString: input.currentDueString ?? null,
            scheduleKind: input.schedule.kind,
            scheduleJson: JSON.stringify(input.schedule),
            updatedAtUtc: now,
          },
        });

      const record = await this.findByTodoistTaskId(input.todoistTaskId);

      if (!record) {
        throw new Error(`Expected habit record for Todoist task ${input.todoistTaskId}.`);
      }

      return record;
    }

    const result = await this.db
      .insert(habit)
      .values({
        title: input.title,
        normalizedTitle: input.normalizedTitle,
        isActive: input.isActive,
        activeStatus: input.activeStatus,
        projectId: input.projectId ?? null,
        projectName: input.projectName ?? null,
        todoistUrl: input.todoistUrl ?? null,
        rawRecurrenceText: input.rawRecurrenceText ?? null,
        currentDueDate: input.currentDueDate ?? null,
        currentDueDatetimeUtc: input.currentDueDatetimeUtc ?? null,
        currentDueString: input.currentDueString ?? null,
        scheduleKind: input.schedule.kind,
        scheduleJson: JSON.stringify(input.schedule),
        updatedAtUtc: now,
      })
      .returning();

    const row = result[0];

    if (!row) {
      throw new Error('Expected inserted habit row.');
    }

    return mapRow(row);
  }

  async findByTodoistTaskId(todoistTaskId: string): Promise<HabitRecord | null> {
    const row = await this.db.query.habit.findFirst({
      where: eq(habit.todoistTaskId, todoistTaskId),
    });

    return row ? mapRow(row) : null;
  }

  async listActive(): Promise<HabitRecord[]> {
    const rows = await this.db.query.habit.findMany({
      where: eq(habit.isActive, true),
      orderBy: [asc(habit.title)],
    });

    return rows.map(mapRow);
  }

  async getSummary() {
    const rows = await this.db.query.habit.findMany();

    return {
      totalCount: rows.length,
      activeCount: rows.filter((row) => row.isActive).length,
      unparsedActiveCount: rows.filter((row) => row.isActive && row.scheduleKind === 'unparsed').length,
      latestUpdatedAtUtc: rows.reduce<string | null>(
        (latest, row) => (!latest || row.updatedAtUtc > latest ? row.updatedAtUtc : latest),
        null,
      ),
    };
  }

  async updateMetrics(habitId: number, metrics: HabitMetrics) {
    await this.db
      .update(habit)
      .set({
        currentStreak: metrics.currentStreak,
        longestStreak: metrics.longestStreak,
        lastCompletedLocalDate: metrics.lastCompletedLocalDate ?? null,
        completionCount: metrics.completionCount,
        streakUpdatedAtUtc: new Date().toISOString(),
        updatedAtUtc: new Date().toISOString(),
      })
      .where(eq(habit.id, habitId));
  }

  async markInactiveByTodoistTaskId(todoistTaskId: string) {
    await this.db
      .update(habit)
      .set({
        isActive: false,
        activeStatus: 'inactive',
        updatedAtUtc: new Date().toISOString(),
      })
      .where(eq(habit.todoistTaskId, todoistTaskId));
  }
}

function mapRow(row: typeof habit.$inferSelect): HabitRecord {
  return {
    id: row.id,
    todoistTaskId: row.todoistTaskId ?? undefined,
    title: row.title,
    normalizedTitle: row.normalizedTitle,
    isActive: row.isActive,
    activeStatus: row.activeStatus as HabitRecord['activeStatus'],
    projectId: row.projectId ?? undefined,
    projectName: row.projectName ?? undefined,
    todoistUrl: row.todoistUrl ?? undefined,
    rawRecurrenceText: row.rawRecurrenceText ?? undefined,
    currentDueDate: row.currentDueDate ?? undefined,
    currentDueDatetimeUtc: row.currentDueDatetimeUtc ?? undefined,
    currentDueString: row.currentDueString ?? undefined,
    schedule: parseSchedule(row.scheduleKind, row.scheduleJson),
    currentStreak: row.currentStreak,
    longestStreak: row.longestStreak,
    lastCompletedLocalDate: row.lastCompletedLocalDate ?? undefined,
    completionCount: row.completionCount,
    streakUpdatedAtUtc: row.streakUpdatedAtUtc ?? undefined,
    createdAtUtc: row.createdAtUtc,
    updatedAtUtc: row.updatedAtUtc,
  };
}

function parseSchedule(kind: string, value: string): HabitSchedule {
  try {
    const parsed = JSON.parse(value) as HabitSchedule;

    if (parsed && typeof parsed.kind === 'string') {
      return parsed;
    }
  } catch {
    // Fall back to persisted kind below.
  }

  return { kind: kind as HabitSchedule['kind'] };
}
