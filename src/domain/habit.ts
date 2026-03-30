export type HabitCompletionSource = 'bot' | 'todoist_external';

export interface HabitCompletionRecord {
  dedupeKey: string;
  todoistTaskId: string;
  normalizedTitle: string;
  title: string;
  completedAtUtc: string;
  completedLocalDate: string;
  source: HabitCompletionSource;
  priority: number;
  projectId?: string;
  projectName?: string;
  url: string;
  createdAtUtc: string;
}

export interface HabitCompletionRecordInput {
  dedupeKey: string;
  todoistTaskId: string;
  normalizedTitle: string;
  title: string;
  completedAtUtc: string;
  completedLocalDate: string;
  source: HabitCompletionSource;
  priority: number;
  projectId?: string;
  projectName?: string;
  url: string;
}
