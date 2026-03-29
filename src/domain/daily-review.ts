export interface DailyTaskSummary {
  id: string;
  title: string;
  priority: number;
  dateKey: string;
  projectId?: string;
  projectName?: string;
  dueLabel: string;
  dueSortKey: string;
  url: string;
}

export interface CompletedTaskSummary {
  id: string;
  title: string;
  priority: number;
  projectId?: string;
  projectName?: string;
  completedAtUtc: string;
  completedLabel: string;
  completedSortKey: string;
  url: string;
}

export interface DailyEventSummary {
  id: string;
  title: string;
  dateKey: string;
  startLabel: string;
  startSortKey: string;
  url: string | null;
}

export interface ReviewDayGroup {
  dateKey: string;
  label: string;
  tasks: DailyTaskSummary[];
  events: DailyEventSummary[];
}

export interface ProviderStatus {
  configured: boolean;
  connected: boolean;
  message?: string;
}

export interface DailyReviewResult {
  overdueTasks: DailyTaskSummary[];
  dueTodayTasks: DailyTaskSummary[];
  completedTodayTasks: CompletedTaskSummary[];
  todayEvents: DailyEventSummary[];
  todoistStatus: ProviderStatus;
  googleCalendarStatus: ProviderStatus;
}

export interface PeriodReviewResult {
  overdueTasks: DailyTaskSummary[];
  dayGroups: ReviewDayGroup[];
  completedTasks?: CompletedTaskSummary[];
  todoistStatus: ProviderStatus;
  googleCalendarStatus: ProviderStatus;
}

export interface UpcomingTaskReviewResult {
  dayGroups: ReviewDayGroup[];
  todoistStatus: ProviderStatus;
}
