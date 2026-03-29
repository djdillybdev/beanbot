import type {
  DailyEventSummary,
  DailyReviewResult,
  DailyTaskSummary,
  PeriodReviewResult,
  ProviderStatus,
  ReviewDayGroup,
} from '../../domain/daily-review';
import type { AppConfig } from '../../config';
import { EventService } from '../events/event-service';
import { TaskService } from '../tasks/task-service';
import { GoogleCalendarClient } from '../../integrations/google-calendar/client';
import { TodoistClient } from '../../integrations/todoist/client';
import { formatLocalDayLabel, getDateKeysInRange, getLocalDateParts } from '../../utils/time';

export class TodayReviewService {
  constructor(
    private readonly config: AppConfig,
    private readonly todoistClient: TodoistClient,
    private readonly googleCalendarClient: GoogleCalendarClient,
    private readonly taskService?: TaskService,
    private readonly eventService?: EventService,
  ) {}

  async getReview(): Promise<DailyReviewResult> {
    const todoistStatus = await this.buildTodoistStatus();
    const googleCalendarStatus = await this.buildGoogleStatus();

    const [taskResult, eventResult] = await Promise.allSettled([
      todoistStatus.connected
        ? this.todoistClient.getDailyTasks()
        : Promise.resolve({ overdueTasks: [], dueTodayTasks: [] }),
      googleCalendarStatus.connected
        ? this.googleCalendarClient.getTodayEvents()
        : Promise.resolve([]),
    ]);

    if (taskResult.status === 'rejected') {
      todoistStatus.connected = false;
      todoistStatus.message = taskResult.reason instanceof Error ? taskResult.reason.message : 'Task fetch failed.';
    }

    if (eventResult.status === 'rejected') {
      googleCalendarStatus.connected = false;
      googleCalendarStatus.message =
        eventResult.reason instanceof Error ? eventResult.reason.message : 'Calendar fetch failed.';
    }

    const overdueTasks = taskResult.status === 'fulfilled' ? taskResult.value.overdueTasks : [];
    const dueTodayTasks = taskResult.status === 'fulfilled' ? taskResult.value.dueTodayTasks : [];
    const result = {
      overdueTasks,
      dueTodayTasks,
      todayEvents: eventResult.status === 'fulfilled' ? eventResult.value : [],
      todoistStatus,
      googleCalendarStatus,
    };

    await this.refreshTaskCache([...overdueTasks, ...dueTodayTasks], todoistStatus.connected);
    await this.refreshEventCache(1, googleCalendarStatus.connected);

    return result;
  }

  async getWeekReview(): Promise<PeriodReviewResult> {
    return this.getPeriodReview(7);
  }

  async getMonthReview(): Promise<PeriodReviewResult> {
    return this.getPeriodReview(31);
  }

  private async getPeriodReview(days: number): Promise<PeriodReviewResult> {
    const todoistStatus = await this.buildTodoistStatus();
    const googleCalendarStatus = await this.buildGoogleStatus();

    const [taskResult, eventResult] = await Promise.allSettled([
      todoistStatus.connected
        ? this.todoistClient.getTasksForUpcomingDays(days)
        : Promise.resolve({ overdueTasks: [], dueTodayTasks: [] }),
      googleCalendarStatus.connected
        ? this.googleCalendarClient.getEventsForUpcomingDays(days)
        : Promise.resolve([]),
    ]);

    if (taskResult.status === 'rejected') {
      todoistStatus.connected = false;
      todoistStatus.message = taskResult.reason instanceof Error ? taskResult.reason.message : 'Task fetch failed.';
    }

    if (eventResult.status === 'rejected') {
      googleCalendarStatus.connected = false;
      googleCalendarStatus.message =
        eventResult.reason instanceof Error ? eventResult.reason.message : 'Calendar fetch failed.';
    }

    const startDate = getLocalDateParts(new Date(), this.config.timezone).date;
    const overdueTasks = taskResult.status === 'fulfilled' ? taskResult.value.overdueTasks : [];
    const dueTasks = taskResult.status === 'fulfilled' ? taskResult.value.dueTodayTasks : [];
    const events = eventResult.status === 'fulfilled' ? eventResult.value : [];

    const result = {
      overdueTasks,
      dayGroups: buildDayGroups(startDate, days, dueTasks, events, this.config.timezone),
      todoistStatus,
      googleCalendarStatus,
    };

    await this.refreshTaskCache([...overdueTasks, ...dueTasks], todoistStatus.connected);
    await this.refreshEventCache(days, googleCalendarStatus.connected);

    return result;
  }

  private async buildTodoistStatus(): Promise<ProviderStatus> {
    if (!this.todoistClient.isConfigured()) {
      return {
        configured: false,
        connected: false,
        message: `Configure Todoist OAuth, then visit ${this.config.publicBaseUrl}/auth/todoist/start`,
      };
    }

    const connected = await this.todoistClient.isConnected();
    return {
      configured: true,
      connected,
      message: connected
        ? undefined
        : `Connect Todoist at ${this.config.publicBaseUrl}/auth/todoist/start`,
    };
  }

  private async buildGoogleStatus(): Promise<ProviderStatus> {
    if (!this.googleCalendarClient.isConfigured()) {
      return {
        configured: false,
        connected: false,
        message: `Configure Google OAuth, then visit ${this.config.publicBaseUrl}/auth/google/start`,
      };
    }

    const connected = await this.googleCalendarClient.isConnected();
    return {
      configured: true,
      connected,
      message: connected
        ? undefined
        : `Connect Google Calendar at ${this.config.publicBaseUrl}/auth/google/start`,
    };
  }

  private async refreshTaskCache(tasks: DailyTaskSummary[], todoistConnected: boolean) {
    if (!todoistConnected || !this.taskService) {
      return;
    }

    try {
      await this.taskService.rememberTaskSummaries(tasks);
    } catch {
      // Cache refresh should not break read views.
    }
  }

  private async refreshEventCache(days: number, googleConnected: boolean) {
    if (!googleConnected || !this.eventService) {
      return;
    }

    try {
      const events = await this.googleCalendarClient.getEventRecordsForUpcomingDays(days);
      await this.eventService.rememberEvents(events);
    } catch {
      // Cache refresh should not break read views.
    }
  }
}

function buildDayGroups(
  startDate: string,
  days: number,
  tasks: DailyTaskSummary[],
  events: DailyEventSummary[],
  timezone: string,
): ReviewDayGroup[] {
  const tasksByDate = new Map<string, DailyTaskSummary[]>();
  const eventsByDate = new Map<string, DailyEventSummary[]>();

  for (const task of tasks) {
    const existing = tasksByDate.get(task.dateKey) ?? [];
    existing.push(task);
    tasksByDate.set(task.dateKey, existing);
  }

  for (const event of events) {
    const existing = eventsByDate.get(event.dateKey) ?? [];
    existing.push(event);
    eventsByDate.set(event.dateKey, existing);
  }

  return getDateKeysInRange(startDate, days)
    .map((dateKey) => ({
      dateKey,
      label: formatLocalDayLabel(dateKey, timezone),
      tasks: tasksByDate.get(dateKey) ?? [],
      events: eventsByDate.get(dateKey) ?? [],
    }))
    .filter((group) => group.tasks.length > 0 || group.events.length > 0);
}
