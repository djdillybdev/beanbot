import type { UndatedTaskReviewResult, UndatedTaskSummary } from '../../domain/daily-review';
import type { ProviderStatus } from '../../domain/daily-review';
import { hasHabitLabel } from '../habits/habit-review';

export function buildUndatedTaskReview(
  tasks: UndatedTaskSummary[],
  todoistStatus: ProviderStatus,
): UndatedTaskReviewResult {
  return {
    tasks: tasks.filter((task) => !hasHabitLabel(task.labels)).sort(compareUndatedTasks),
    todoistStatus,
  };
}

function compareUndatedTasks(left: UndatedTaskSummary, right: UndatedTaskSummary) {
  return right.priority - left.priority || left.title.localeCompare(right.title);
}
