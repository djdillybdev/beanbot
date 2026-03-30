import type { CompletedTaskSummary } from '../../domain/daily-review';
import type { HabitCompletionRecordInput, HabitCompletionSource } from '../../domain/habit';
import type { TodoistTaskRecord } from '../../domain/task';
import { getLocalDateParts } from '../../utils/time';
import { hasHabitLabel } from './habit-review';

export function buildHabitCompletionDedupeKey(todoistTaskId: string, completedLocalDate: string) {
  return `${todoistTaskId}:${completedLocalDate}`;
}

export function buildHabitCompletionRecordFromTask(
  task: Pick<TodoistTaskRecord, 'id' | 'normalizedTitle' | 'title' | 'priority' | 'projectId' | 'projectName' | 'url' | 'labels'>,
  completedAtUtc: string,
  timezone: string,
  source: HabitCompletionSource,
): HabitCompletionRecordInput | null {
  if (!hasHabitLabel(task.labels)) {
    return null;
  }

  const completedLocalDate = getLocalDateParts(new Date(completedAtUtc), timezone).date;

  return {
    dedupeKey: buildHabitCompletionDedupeKey(task.id, completedLocalDate),
    todoistTaskId: task.id,
    normalizedTitle: task.normalizedTitle,
    title: task.title,
    completedAtUtc,
    completedLocalDate,
    source,
    priority: task.priority,
    projectId: task.projectId,
    projectName: task.projectName,
    url: task.url,
  };
}

export function buildExternalHabitCompletionRecords(
  completedTasks: CompletedTaskSummary[],
  cachedTasksById: Map<string, TodoistTaskRecord>,
  timezone: string,
): HabitCompletionRecordInput[] {
  const records: HabitCompletionRecordInput[] = [];

  for (const completedTask of completedTasks) {
    const cachedTask = cachedTasksById.get(completedTask.id);

    if (!cachedTask) {
      continue;
    }

    const record = buildHabitCompletionRecordFromTask(
      {
        ...cachedTask,
        priority: completedTask.priority,
        projectId: completedTask.projectId ?? cachedTask.projectId,
        projectName: completedTask.projectName ?? cachedTask.projectName,
        url: completedTask.url,
      },
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
