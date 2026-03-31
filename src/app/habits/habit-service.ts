import type { DailyTaskSummary, HabitStreakSummary, UnparsedHabitSummary } from '../../domain/daily-review';
import type {
  HabitActiveStatus,
  HabitCompletionSource,
  HabitRecord,
} from '../../domain/habit';
import { HabitCompletionRepository } from '../../db/habit-completion-repository';
import { HabitRepository } from '../../db/habit-repository';
import type { TodoistCompletedTaskRecord, TodoistTaskRecord } from '../../domain/task';
import type { Logger } from '../../logging/logger';
import { normalizeTaskTitle } from '../../utils/text';
import { getLocalDateParts } from '../../utils/time';
import { computeHabitMetrics, normalizeHabitSchedule } from './habit-schedule';
import { hasHabitLabel } from './habit-review';

type HabitTaskLike = Pick<
  TodoistTaskRecord,
  | 'id'
  | 'title'
  | 'normalizedTitle'
  | 'recurring'
  | 'projectId'
  | 'projectName'
  | 'dueDate'
  | 'dueDateTimeUtc'
  | 'dueString'
  | 'url'
  | 'labels'
>;

type CompletedHabitTaskLike = Pick<
  TodoistCompletedTaskRecord,
  | 'id'
  | 'title'
  | 'normalizedTitle'
  | 'recurring'
  | 'projectId'
  | 'projectName'
  | 'dueDate'
  | 'dueDateTimeUtc'
  | 'dueString'
  | 'url'
  | 'labels'
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

    const today = getLocalDateParts(new Date(), this.timezone).date;

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
      currentDueDate: getTaskDueDate(task),
      currentDueDatetimeUtc: 'dueDateTimeUtc' in task ? task.dueDateTimeUtc : undefined,
      currentDueString: task.dueString,
      activeStatus: classifyHabitTaskStatus({
        dueDate: getTaskDueDate(task),
        dueDateTimeUtc: 'dueDateTimeUtc' in task ? task.dueDateTimeUtc : undefined,
      }, today),
      schedule: normalizeHabitSchedule(task.dueString, task.recurring),
    });
  }

  async syncTasks(tasks: Array<HabitTaskLike | DailyTaskSummary>) {
    for (const task of tasks) {
      await this.syncTask(task);
    }
  }

  async syncActiveTasks(tasks: HabitTaskLike[], now = new Date()) {
    const today = getLocalDateParts(now, this.timezone).date;
    const activeTaskIds = new Set<string>();

    for (const task of tasks) {
      if (!isTrackedHabitTask(task)) {
        continue;
      }

      activeTaskIds.add(task.id);
      await this.habitRepository.upsert({
        todoistTaskId: task.id,
        title: task.title,
        normalizedTitle: task.normalizedTitle,
        isActive: true,
        activeStatus: classifyHabitTaskStatus(task, today),
        projectId: task.projectId,
        projectName: task.projectName,
        todoistUrl: task.url,
        rawRecurrenceText: task.dueString,
        currentDueDate: task.dueDate,
        currentDueDatetimeUtc: task.dueDateTimeUtc,
        currentDueString: task.dueString,
        schedule: normalizeHabitSchedule(task.dueString, task.recurring),
      });
    }

    const existing = await this.habitRepository.listActive();

    for (const habit of existing) {
      if (habit.todoistTaskId && !activeTaskIds.has(habit.todoistTaskId)) {
        await this.habitRepository.markInactiveByTodoistTaskId(habit.todoistTaskId);
      }
    }
  }

  async recordCompletion(
    task: HabitTaskLike | CompletedHabitTaskLike,
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
    completedTasks: TodoistCompletedTaskRecord[],
  ) {
    for (const completedTask of completedTasks) {
      if (!isTrackedHabitTask(completedTask)) {
        continue;
      }

      await this.recordCompletion(
        completedTask,
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
      .filter((habit) => habit.schedule.kind !== 'unparsed')
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

  async listActiveUnparsedHabits(): Promise<UnparsedHabitSummary[]> {
    const habits = await this.habitRepository.listActive();

    return habits
      .filter((habit) => habit.schedule.kind === 'unparsed')
      .map((habit) => ({
        habitId: habit.id,
        title: habit.title,
        rawRecurrenceText: habit.schedule.rawText ?? habit.rawRecurrenceText,
        activeStatus: habit.activeStatus,
      }))
      .sort((left, right) => {
        return compareActiveStatus(left.activeStatus, right.activeStatus) || left.title.localeCompare(right.title);
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
      { activeStatus: habit.activeStatus },
    );

    await this.habitRepository.updateMetrics(habitId, metrics);
  }
}

function isTrackedHabitTask(task: { labels?: string[]; recurring?: boolean }) {
  return hasHabitLabel(task.labels) && task.recurring === true;
}

export function classifyHabitTaskStatus(
  task: Pick<HabitTaskLike, 'dueDate' | 'dueDateTimeUtc'>,
  today: string,
): HabitActiveStatus {
  const dueDate = task.dueDate;

  if (!dueDate) {
    return 'future';
  }

  if (dueDate < today) {
    return 'overdue';
  }

  if (dueDate === today) {
    return 'due_today';
  }

  return 'future';
}

function getTaskDueDate(task: HabitTaskLike | DailyTaskSummary) {
  return (task as HabitTaskLike).dueDate ?? (task as DailyTaskSummary).dateKey;
}

function compareActiveStatus(
  left: UnparsedHabitSummary['activeStatus'],
  right: UnparsedHabitSummary['activeStatus'],
) {
  const rank: Record<UnparsedHabitSummary['activeStatus'], number> = {
    overdue: 0,
    due_today: 1,
    future: 2,
    inactive: 3,
  };

  return rank[left] - rank[right];
}
