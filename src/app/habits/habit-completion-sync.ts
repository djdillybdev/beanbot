import type { CompletedTaskSummary } from '../../domain/daily-review';
import type { HabitCompletionSource } from '../../domain/habit';
import type { TodoistTaskRecord } from '../../domain/task';
import { getLocalDateParts } from '../../utils/time';
import { hasHabitLabel } from './habit-review';

export interface HabitCompletionCandidate {
  todoistTaskId: string;
  completedAtUtc: string;
  completedLocalDate: string;
  source: HabitCompletionSource;
}

export function buildHabitCompletionCandidateFromTask(
  task: Pick<TodoistTaskRecord, 'id' | 'labels'>,
  completedAtUtc: string,
  timezone: string,
  source: HabitCompletionSource,
): HabitCompletionCandidate | null {
  if (!hasHabitLabel(task.labels)) {
    return null;
  }

  const completedLocalDate = getLocalDateParts(new Date(completedAtUtc), timezone).date;

  return {
    todoistTaskId: task.id,
    completedAtUtc,
    completedLocalDate,
    source,
  };
}

export function buildExternalHabitCompletionCandidates(
  completedTasks: CompletedTaskSummary[],
  cachedTasksById: Map<string, TodoistTaskRecord>,
  timezone: string,
): HabitCompletionCandidate[] {
  const records: HabitCompletionCandidate[] = [];

  for (const completedTask of completedTasks) {
    const cachedTask = cachedTasksById.get(completedTask.id);

    if (!cachedTask) {
      continue;
    }

    const record = buildHabitCompletionCandidateFromTask(
      cachedTask,
      completedTask.completedAtUtc,
      timezone,
      'todoist_external',
    );

    if (record) {
      records.push(record);
    }
  }

  return records;
}
