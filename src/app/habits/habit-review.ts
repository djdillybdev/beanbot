import type {
  CompletedTaskSummary,
  DailyTaskSummary,
  HabitReviewResult,
  HabitStreakSummary,
  ProviderStatus,
} from '../../domain/daily-review';
import { formatLocalTime } from '../../utils/time';

const HABIT_LABEL = 'habit';

export interface HabitHistoryEntry {
  id: string;
  title: string;
  normalizedTitle: string;
  labels?: string[];
  completedAtUtc: string;
  url: string;
  priority: number;
  projectId?: string;
  projectName?: string;
}

export function hasHabitLabel(labels?: string[]) {
  return Boolean(labels?.includes(HABIT_LABEL));
}

export function splitTasksByHabitLabel(tasks: DailyTaskSummary[]) {
  const habits: DailyTaskSummary[] = [];
  const nonHabits: DailyTaskSummary[] = [];

  for (const task of tasks) {
    if (hasHabitLabel(task.labels)) {
      habits.push(task);
    } else {
      nonHabits.push(task);
    }
  }

  return { habits, nonHabits };
}

export function splitCompletedTasksByHabitLabel(tasks: CompletedTaskSummary[]) {
  const habits: CompletedTaskSummary[] = [];
  const nonHabits: CompletedTaskSummary[] = [];

  for (const task of tasks) {
    if (hasHabitLabel(task.labels)) {
      habits.push(task);
    } else {
      nonHabits.push(task);
    }
  }

  return { habits, nonHabits };
}

export function mapCompletedHabitEntry(
  task: HabitHistoryEntry,
  timezone: string,
): CompletedTaskSummary {
  return {
    id: task.id,
    title: task.title,
    priority: task.priority,
    projectId: task.projectId,
    projectName: task.projectName,
    completedAtUtc: task.completedAtUtc,
    completedLabel: `Done at ${formatLocalTime(new Date(task.completedAtUtc), timezone)}`,
    completedSortKey: task.completedAtUtc,
    labels: task.labels,
    url: task.url,
  };
}

export function buildHabitReviewResult(
  overdueHabits: DailyTaskSummary[],
  dueTodayHabits: DailyTaskSummary[],
  completedTodayHabits: CompletedTaskSummary[],
  streaks: HabitStreakSummary[],
  todoistStatus: ProviderStatus,
): HabitReviewResult {
  return {
    overdueHabits,
    dueTodayHabits,
    completedTodayHabits,
    streaks,
    todoistStatus,
    stats: {
      trackedHabitCount: streaks.length,
      completedTodayCount: completedTodayHabits.length,
      remainingTodayCount: overdueHabits.length + dueTodayHabits.length,
      longestCurrentStreak: streaks.reduce((max, streak) => Math.max(max, streak.currentStreak), 0),
    },
  };
}
