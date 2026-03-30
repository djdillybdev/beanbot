import type {
  DailyReviewResult,
  HabitReviewResult,
  PeriodReviewResult,
  UndatedTaskReviewResult,
  UpcomingTaskReviewResult,
} from '../../domain/daily-review';

export function buildTodayStatusSnapshot(periodKey: string, review: DailyReviewResult) {
  return JSON.stringify({
    periodKey,
    overdueTasks: review.overdueTasks.map((task) => ({
      id: task.id,
      title: task.title,
      dueLabel: task.dueLabel,
      priority: task.priority,
    })),
    dueTodayTasks: review.dueTodayTasks.map((task) => ({
      id: task.id,
      title: task.title,
      dueLabel: task.dueLabel,
      priority: task.priority,
    })),
    completedTodayTasks: review.completedTodayTasks.map((task) => ({
      id: task.id,
      title: task.title,
      completedAtUtc: task.completedAtUtc,
      priority: task.priority,
    })),
    todayEvents: review.todayEvents.map((event) => ({
      id: event.id,
      title: event.title,
      startLabel: event.startLabel,
    })),
    todoistStatusMessage: review.todoistStatus.message ?? null,
    googleCalendarStatusMessage: review.googleCalendarStatus.message ?? null,
  });
}

export function buildPeriodStatusSnapshot(periodKey: string, review: PeriodReviewResult) {
  return JSON.stringify({
    periodKey,
    overdueTasks: review.overdueTasks.map((task) => ({
      id: task.id,
      title: task.title,
      dueLabel: task.dueLabel,
      priority: task.priority,
    })),
    completedTasks: (review.completedTasks ?? []).map((task) => ({
      id: task.id,
      title: task.title,
      completedAtUtc: task.completedAtUtc,
      priority: task.priority,
    })),
    dayGroups: review.dayGroups.map((group) => ({
      dateKey: group.dateKey,
      taskIds: group.tasks.map((task) => task.id),
      eventIds: group.events.map((event) => event.id),
    })),
    todoistStatusMessage: review.todoistStatus.message ?? null,
    googleCalendarStatusMessage: review.googleCalendarStatus.message ?? null,
  });
}

export function buildUpcomingStatusSnapshot(periodKey: string, review: UpcomingTaskReviewResult) {
  return JSON.stringify({
    periodKey,
    dayGroups: review.dayGroups.map((group) => ({
      dateKey: group.dateKey,
      taskIds: group.tasks.map((task) => task.id),
    })),
    todoistStatusMessage: review.todoistStatus.message ?? null,
  });
}

export function buildHabitStatusSnapshot(periodKey: string, review: HabitReviewResult) {
  return JSON.stringify({
    periodKey,
    overdueHabits: review.overdueHabits.map((task) => ({
      id: task.id,
      title: task.title,
      dueLabel: task.dueLabel,
    })),
    dueTodayHabits: review.dueTodayHabits.map((task) => ({
      id: task.id,
      title: task.title,
      dueLabel: task.dueLabel,
    })),
    completedTodayHabits: review.completedTodayHabits.map((task) => ({
      id: task.id,
      title: task.title,
      completedAtUtc: task.completedAtUtc,
    })),
    streaks: review.streaks.map((streak) => ({
      normalizedTitle: streak.normalizedTitle,
      currentStreak: streak.currentStreak,
      completedToday: streak.completedToday,
    })),
    todoistStatusMessage: review.todoistStatus.message ?? null,
  });
}

export function buildUndatedStatusSnapshot(periodKey: string, review: UndatedTaskReviewResult) {
  return JSON.stringify({
    periodKey,
    taskIds: review.tasks.map((task) => task.id),
    todoistStatusMessage: review.todoistStatus.message ?? null,
  });
}
