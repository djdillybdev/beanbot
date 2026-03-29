import type {
  CompletedTaskSummary,
  DailyTaskSummary,
  HabitReviewResult,
  HabitStreakSummary,
  ProviderStatus,
} from '../../domain/daily-review';
import { normalizeTaskTitle } from '../../utils/text';
import { formatLocalTime, getLocalDateParts } from '../../utils/time';

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
  now: Date,
  timezone: string,
  overdueHabits: DailyTaskSummary[],
  dueTodayHabits: DailyTaskSummary[],
  completedTodayHabits: CompletedTaskSummary[],
  history: HabitHistoryEntry[],
  todoistStatus: ProviderStatus,
): HabitReviewResult {
  const streaks = buildHabitStreaks(now, timezone, history, [...overdueHabits, ...dueTodayHabits]);

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

export function buildHabitStreaks(
  now: Date,
  timezone: string,
  history: HabitHistoryEntry[],
  activeHabits: DailyTaskSummary[] = [],
): HabitStreakSummary[] {
  const today = getLocalDateParts(now, timezone).date;
  const byHabit = new Map<string, { title: string; dates: Set<string> }>();

  for (const entry of history) {
    if (!hasHabitLabel(entry.labels)) {
      continue;
    }

    const completedDate = getLocalDateParts(new Date(entry.completedAtUtc), timezone).date;
    const existing = byHabit.get(entry.normalizedTitle) ?? {
      title: entry.title,
      dates: new Set<string>(),
    };

    existing.title = entry.title;
    existing.dates.add(completedDate);
    byHabit.set(entry.normalizedTitle, existing);
  }

  for (const habit of activeHabits) {
    const normalizedTitle = normalizeHabitTitle(habit.title);
    const existing = byHabit.get(normalizedTitle) ?? {
      title: habit.title,
      dates: new Set<string>(),
    };

    existing.title = habit.title;
    byHabit.set(normalizedTitle, existing);
  }

  return Array.from(byHabit.entries())
    .map(([normalizedTitle, value]) => {
      const completedToday = value.dates.has(today);

      return {
        normalizedTitle,
        title: value.title,
        currentStreak: countCurrentStreak(today, value.dates),
        completedToday,
      };
    })
    .sort((left, right) => {
      return (
        Number(right.completedToday) - Number(left.completedToday) ||
        right.currentStreak - left.currentStreak ||
        left.title.localeCompare(right.title)
      );
    });
}

function normalizeHabitTitle(title: string) {
  return normalizeTaskTitle(title);
}

function countCurrentStreak(today: string, dates: Set<string>) {
  let streak = 0;
  let cursor = today;

  while (dates.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }

  return streak;
}

function addDays(dateString: string, days: number) {
  const match = dateString.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    throw new Error(`Invalid ISO date: ${dateString}`);
  }

  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return date.toISOString().slice(0, 10);
}
