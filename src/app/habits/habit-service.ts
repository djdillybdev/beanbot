import type { CompletedTaskSummary, DailyTaskSummary, HabitStreakSummary } from '../../domain/daily-review';
import type {
  HabitCompletionSource,
  HabitRecord,
} from '../../domain/habit';
import { HabitCompletionRepository } from '../../db/habit-completion-repository';
import { HabitRepository } from '../../db/habit-repository';
import type { TodoistTaskRecord } from '../../domain/task';
import type { Logger } from '../../logging/logger';
import { normalizeTaskTitle } from '../../utils/text';
import { getLocalDateParts } from '../../utils/time';
import { computeHabitMetrics, normalizeHabitSchedule } from './habit-schedule';
import { hasHabitLabel } from './habit-review';

type HabitTaskLike = Pick<
  TodoistTaskRecord,
  'id' | 'title' | 'normalizedTitle' | 'recurring' | 'projectId' | 'projectName' | 'dueString' | 'url' | 'labels'
>;

export class HabitService {
  constructor(
    private readonly timezone: string,
    private readonly habitRepository: HabitRepository,
    private readonly habitCompletionRepository: HabitCompletionRepository,
    private readonly logger?: Logger,
  ) {}

  async syncTask(task: HabitTaskLike | DailyTaskSummary) {
    if (!isTrackedHabitTask(task)) {
      await this.habitRepository.markInactiveByTodoistTaskId(task.id);
      return null;
    }

    return this.habitRepository.upsert({
      todoistTaskId: task.id,
      title: task.title,
      normalizedTitle: 'normalizedTitle' in task && task.normalizedTitle
        ? task.normalizedTitle
        : normalizeTaskTitle(task.title),
      isActive: true,
      projectId: task.projectId,
      projectName: task.projectName,
      todoistUrl: task.url,
      rawRecurrenceText: task.dueString,
      schedule: normalizeHabitSchedule(task.dueString, task.recurring),
    });
  }

  async syncTasks(tasks: Array<HabitTaskLike | DailyTaskSummary>) {
    for (const task of tasks) {
      await this.syncTask(task);
    }
  }

  async recordCompletion(
    task: HabitTaskLike,
    completedAtUtc: string,
    source: HabitCompletionSource,
  ) {
    let habit = await this.resolveHabitForTask(task);

    if (!habit) {
      return;
    }

    const completedLocalDate = getLocalDateParts(new Date(completedAtUtc), this.timezone).date;

    await this.habitCompletionRepository.upsert({
      habitId: habit.id,
      todoistTaskId: task.id,
      completedAtUtc,
      completedLocalDate,
      source,
    });
    await this.refreshHabitMetrics(habit.id);
    habit = await this.habitRepository.findByTodoistTaskId(task.id) ?? habit;

    this.logger?.debug('Recorded habit completion', {
      habitId: habit.id,
      todoistTaskId: task.id,
      completedLocalDate,
      source,
    });
  }

  async recordExternalCompletions(
    completedTasks: CompletedTaskSummary[],
    cachedTasksById: Map<string, TodoistTaskRecord>,
  ) {
    for (const completedTask of completedTasks) {
      const cachedTask = cachedTasksById.get(completedTask.id);

      if (!cachedTask) {
        continue;
      }

      await this.recordCompletion(
        {
          ...cachedTask,
          projectId: completedTask.projectId ?? cachedTask.projectId,
          projectName: completedTask.projectName ?? cachedTask.projectName,
          url: completedTask.url,
        },
        completedTask.completedAtUtc,
        'todoist_external',
      );
    }
  }

  async deleteLatestCompletionForTask(todoistTaskId: string) {
    const habit = await this.habitRepository.findByTodoistTaskId(todoistTaskId);

    if (!habit) {
      return;
    }

    await this.habitCompletionRepository.deleteLatestForTask(todoistTaskId);
    await this.refreshHabitMetrics(habit.id);
  }

  async listCompletedForLocalDate(localDate: string) {
    const completions = await this.habitCompletionRepository.listByLocalDate(localDate);
    const habits = await this.habitRepository.listActive();
    const habitById = new Map(habits.map((habit) => [habit.id, habit]));

    return completions
      .map((completion) => {
        const habit = habitById.get(completion.habitId);

        if (!habit) {
          return null;
        }

        return {
          habit,
          completion,
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  }

  async listActiveStreaks(now: Date): Promise<HabitStreakSummary[]> {
    const today = getLocalDateParts(now, this.timezone).date;
    const habits = await this.habitRepository.listActive();

    return habits
      .map((habit) => ({
        habitId: habit.id,
        title: habit.title,
        currentStreak: habit.currentStreak,
        completedToday: habit.lastCompletedLocalDate === today,
      }))
      .sort((left, right) => {
        return (
          Number(right.completedToday) - Number(left.completedToday) ||
          right.currentStreak - left.currentStreak ||
          left.title.localeCompare(right.title)
        );
      });
  }

  async refreshAllActiveMetrics(now = new Date()) {
    const habits = await this.habitRepository.listActive();

    for (const habit of habits) {
      await this.refreshHabitMetrics(habit.id, now);
    }
  }

  private async resolveHabitForTask(task: HabitTaskLike): Promise<HabitRecord | null> {
    const existing = await this.habitRepository.findByTodoistTaskId(task.id);

    if (existing) {
      return existing;
    }

    if (!isTrackedHabitTask(task)) {
      return null;
    }

    return this.syncTask(task);
  }

  private async refreshHabitMetrics(habitId: number, now = new Date()) {
    const habits = await this.habitRepository.listActive();
    const habit = habits.find((entry) => entry.id === habitId);

    if (!habit) {
      return;
    }

    const completions = await this.habitCompletionRepository.listForHabit(habitId);
    const metrics = computeHabitMetrics(
      getLocalDateParts(now, this.timezone).date,
      habit.schedule,
      completions.map((completion) => completion.completedLocalDate),
    );

    await this.habitRepository.updateMetrics(habitId, metrics);
  }
}

function isTrackedHabitTask(task: { labels?: string[]; recurring?: boolean }) {
  return hasHabitLabel(task.labels) && task.recurring === true;
}
