import type { CompletedTaskSummary, HabitStreakSummary, UnparsedHabitSummary } from '../../domain/daily-review';
import type { TaskCompletionSource, TodoistTaskRecord } from '../../domain/task';
import { TodoistTaskMapRepository } from '../../db/todoist-task-map-repository';
import { TaskCompletionRepository } from '../../db/task-completion-repository';
import type { Logger } from '../../logging/logger';
import { getLocalDateParts } from '../../utils/time';
import { computeHabitMetrics, normalizeHabitSchedule } from './habit-schedule';
import { hasHabitLabel } from './habit-review';
import type { HabitActiveStatus, HabitMetrics } from '../../domain/habit';

type HabitTaskLike = Pick<
  TodoistTaskRecord,
  | 'id'
  | 'title'
  | 'normalizedTitle'
  | 'priority'
  | 'recurring'
  | 'projectId'
  | 'projectName'
  | 'dueDate'
  | 'dueDateTimeUtc'
  | 'dueString'
  | 'url'
  | 'labels'
>;

type CompletedTaskLike = Pick<
  CompletedTaskSummary,
  | 'id'
  | 'title'
  | 'normalizedTitle'
  | 'priority'
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
    private readonly taskMapRepository: TodoistTaskMapRepository,
    private readonly taskCompletionRepository: TaskCompletionRepository,
    private readonly logger?: Logger,
  ) {}

  async recordCompletion(
    task: HabitTaskLike | CompletedTaskLike,
    completedAtUtc: string,
    source: TaskCompletionSource,
  ) {
    if (source === 'todoist_external') {
      await this.taskCompletionRepository.recordExternalCompletion(task, completedAtUtc, this.timezone);
    } else {
      await this.taskCompletionRepository.recordBotCompletion(task, completedAtUtc, this.timezone);
    }

    this.logger?.debug('Recorded task completion for habit tracking', {
      todoistTaskId: task.id,
      completedLocalDate: getLocalDateParts(new Date(completedAtUtc), this.timezone).date,
      source,
      habitQualified: isTrackedHabitTask(task),
    });
  }

  async recordExternalCompletions(completedTasks: CompletedTaskSummary[]) {
    for (const completedTask of completedTasks) {
      await this.recordCompletion(completedTask, completedTask.completedAtUtc, 'todoist_external');
    }
  }

  async deleteLatestCompletionForTask(todoistTaskId: string) {
    await this.taskCompletionRepository.deleteLatestForTask(todoistTaskId);
  }

  async listCompletedForLocalDate(localDate: string) {
    const [completions, currentHabitTasks] = await Promise.all([
      this.taskCompletionRepository.listByLocalDate(localDate),
      this.listCurrentHabitTasks(),
    ]);
    const habitTaskById = new Map(currentHabitTasks.map((task) => [task.id, task]));

    return completions
      .map((completion) => {
        const task = habitTaskById.get(completion.todoistTaskId);

        if (!task) {
          return null;
        }

        return { task, completion };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  }

  async listActiveStreaks(now: Date): Promise<HabitStreakSummary[]> {
    const today = getLocalDateParts(now, this.timezone).date;
    const tasks = await this.listCurrentHabitTasks();

    return Promise.all(
      tasks.map(async (task) => {
        const metrics = await this.computeMetricsForTask(task, now);

        return {
          habitId: task.id,
          title: task.title,
          currentStreak: metrics.currentStreak,
          completedToday: metrics.lastCompletedLocalDate === today,
        };
      }),
    ).then((streaks) =>
      streaks
        .filter((streak) => {
          const task = tasks.find((entry) => entry.id === streak.habitId);
          return normalizeHabitSchedule(task?.dueString, task?.recurring).kind !== 'unparsed';
        })
        .sort((left, right) => (
          Number(right.completedToday) - Number(left.completedToday) ||
          right.currentStreak - left.currentStreak ||
          left.title.localeCompare(right.title)
        )),
    );
  }

  async listActiveUnparsedHabits(now = new Date()): Promise<UnparsedHabitSummary[]> {
    const today = getLocalDateParts(now, this.timezone).date;
    const tasks = await this.listCurrentHabitTasks();

    return tasks
      .map((task) => ({
        habitId: task.id,
        title: task.title,
        rawRecurrenceText: task.dueString,
        activeStatus: classifyHabitTaskStatus(task, today),
        scheduleKind: normalizeHabitSchedule(task.dueString, task.recurring).kind,
      }))
      .filter((habit) => habit.scheduleKind === 'unparsed')
      .map(({ scheduleKind: _scheduleKind, ...habit }) => habit)
      .sort((left, right) => (
        compareActiveStatus(left.activeStatus, right.activeStatus) ||
        left.title.localeCompare(right.title)
      ));
  }

  private async listCurrentHabitTasks() {
    return this.taskMapRepository.listCurrentHabitTasks();
  }

  private async computeMetricsForTask(task: HabitTaskLike, now: Date): Promise<HabitMetrics> {
    const completions = await this.taskCompletionRepository.listForTask(task.id);
    const completionDates = [...new Set(
      completions
        .filter((completion) => completion.recurring && hasHabitLabel(completion.labels))
        .map((completion) => completion.completedLocalDate),
    )];

    return computeHabitMetrics(
      getLocalDateParts(now, this.timezone).date,
      normalizeHabitSchedule(task.dueString, task.recurring),
      completionDates,
      { activeStatus: classifyHabitTaskStatus(task, getLocalDateParts(now, this.timezone).date) },
    );
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
