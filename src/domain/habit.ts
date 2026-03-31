export type HabitCompletionSource = 'bot' | 'todoist_external';

export type HabitScheduleKind = 'daily' | 'weekly_days' | 'interval_days' | 'unparsed';

export type HabitWeekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export interface HabitSchedule {
  kind: HabitScheduleKind;
  rawText?: string;
  daysOfWeek?: HabitWeekday[];
  intervalDays?: number;
}

export interface HabitRecord {
  id: number;
  todoistTaskId?: string;
  title: string;
  normalizedTitle: string;
  isActive: boolean;
  projectId?: string;
  projectName?: string;
  todoistUrl?: string;
  rawRecurrenceText?: string;
  schedule: HabitSchedule;
  currentStreak: number;
  longestStreak: number;
  lastCompletedLocalDate?: string;
  completionCount: number;
  streakUpdatedAtUtc?: string;
  createdAtUtc: string;
  updatedAtUtc: string;
}

export interface HabitRecordInput {
  todoistTaskId?: string;
  title: string;
  normalizedTitle: string;
  isActive: boolean;
  projectId?: string;
  projectName?: string;
  todoistUrl?: string;
  rawRecurrenceText?: string;
  schedule: HabitSchedule;
}

export interface HabitMetrics {
  currentStreak: number;
  longestStreak: number;
  lastCompletedLocalDate?: string;
  completionCount: number;
}

export interface HabitCompletionRecord {
  id: number;
  habitId: number;
  todoistTaskId?: string;
  completedAtUtc: string;
  completedLocalDate: string;
  source: HabitCompletionSource;
  createdAtUtc: string;
}

export interface HabitCompletionRecordInput {
  habitId: number;
  todoistTaskId?: string;
  completedAtUtc: string;
  completedLocalDate: string;
  source: HabitCompletionSource;
}
