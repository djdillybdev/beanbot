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
import type { Logger } from '../../logging/logger';
import {
  formatLocalDayLabel,
  getDateKeysInRange,
  getLocalDateParts,
  getMonthBounds,
  getWeekBounds,
} from '../../utils/time';

export class TodayReviewService {
  constructor(
    private readonly config: AppConfig,
    private readonly todoistClient: TodoistClient,
    private readonly googleCalendarClient: GoogleCalendarClient,
    private readonly taskService?: TaskService,
    private readonly eventService?: EventService,
    private readonly logger?: Logger,
  ) {}

  async getReview(now = new Date()): Promise<DailyReviewResult> {
    this.logger?.debug('Building today review');
    const todoistStatus = await this.buildTodoistStatus();
    const googleCalendarStatus = await this.buildGoogleStatus();

    const [taskResult, completedTaskResult, eventResult] = await Promise.allSettled([
      todoistStatus.connected
        ? this.todoistClient.getDailyTasks()
        : Promise.resolve({ overdueTasks: [], dueTodayTasks: [] }),
      todoistStatus.connected
        ? this.todoistClient.getCompletedTasksForToday(now)
        : Promise.resolve([]),
      googleCalendarStatus.connected
        ? this.googleCalendarClient.getTodayEvents()
        : Promise.resolve([]),
    ]);

    if (taskResult.status === 'rejected') {
      todoistStatus.connected = false;
      todoistStatus.message = taskResult.reason instanceof Error ? taskResult.reason.message : 'Task fetch failed.';
    }

    if (completedTaskResult.status === 'rejected') {
      todoistStatus.message = completedTaskResult.reason instanceof Error
        ? completedTaskResult.reason.message
        : 'Completed task fetch failed.';
    }

    if (eventResult.status === 'rejected') {
      googleCalendarStatus.connected = false;
      googleCalendarStatus.message =
        eventResult.reason instanceof Error ? eventResult.reason.message : 'Calendar fetch failed.';
    }

    const overdueTasks = taskResult.status === 'fulfilled' ? taskResult.value.overdueTasks : [];
    const dueTodayTasks = taskResult.status === 'fulfilled' ? taskResult.value.dueTodayTasks : [];
    const completedTodayTasks = completedTaskResult.status === 'fulfilled' ? completedTaskResult.value : [];
    const result = {
      overdueTasks,
      dueTodayTasks,
      completedTodayTasks,
      todayEvents: eventResult.status === 'fulfilled' ? eventResult.value : [],
      todoistStatus,
      googleCalendarStatus,
    };

    await this.refreshTaskCache([...overdueTasks, ...dueTodayTasks], todoistStatus.connected);
    await this.refreshEventCache(1, googleCalendarStatus.connected);
    this.logger?.info('Built today review', {
      overdueCount: overdueTasks.length,
      dueTodayCount: dueTodayTasks.length,
      completedTodayCount: completedTodayTasks.length,
      eventCount: result.todayEvents.length,
      todoistConnected: todoistStatus.connected,
      googleCalendarConnected: googleCalendarStatus.connected,
    });

    return result;
  }

  async getWeekReview(): Promise<PeriodReviewResult> {
    return this.getPeriodReview(7);
  }

  async getMonthReview(): Promise<PeriodReviewResult> {
    return this.getPeriodReview(31);
  }

  async getWeekStatusReview(now = new Date()): Promise<PeriodReviewResult> {
    const bounds = getWeekBounds(now, this.config.timezone);
    const today = getLocalDateParts(now, this.config.timezone).date;
    const daysRemaining = Math.max(getDateDistance(today, bounds.endExclusiveDate), 1);
    const base = await this.getPeriodStatusReview(bounds.startDate, bounds.endExclusiveDate, daysRemaining);
    const completedTasks = await this.getCompletedTasksForRange(bounds.startUtc, bounds.endUtc);

    return {
      ...base,
      completedTasks,
    };
  }

  async getMonthStatusReview(now = new Date()): Promise<PeriodReviewResult> {
    const bounds = getMonthBounds(now, this.config.timezone);
    const today = getLocalDateParts(now, this.config.timezone).date;
    const daysRemaining = Math.max(getDateDistance(today, bounds.endExclusiveDate), 1);

    return this.getPeriodStatusReview(bounds.startDate, bounds.endExclusiveDate, daysRemaining);
  }

  private async getPeriodReview(days: number): Promise<PeriodReviewResult> {
    this.logger?.debug('Building period review', { days });
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
    this.logger?.info('Built period review', {
      days,
      overdueCount: overdueTasks.length,
      dueTaskCount: dueTasks.length,
      dayGroupCount: result.dayGroups.length,
      todoistConnected: todoistStatus.connected,
      googleCalendarConnected: googleCalendarStatus.connected,
    });

    return result;
  }

  private async getPeriodStatusReview(
    startDate: string,
    endExclusiveDate: string,
    daysRemaining: number,
  ): Promise<PeriodReviewResult> {
    this.logger?.debug('Building live period status review', {
      startDate,
      endExclusiveDate,
      daysRemaining,
    });
    const todoistStatus = await this.buildTodoistStatus();
    const googleCalendarStatus = await this.buildGoogleStatus();

    const [taskResult, eventResult] = await Promise.allSettled([
      todoistStatus.connected
        ? this.todoistClient.getTasksForUpcomingDays(daysRemaining)
        : Promise.resolve({ overdueTasks: [], dueTodayTasks: [] }),
      googleCalendarStatus.connected
        ? this.googleCalendarClient.getEventsForUpcomingDays(daysRemaining)
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
    const dueTasks = taskResult.status === 'fulfilled' ? taskResult.value.dueTodayTasks : [];
    const events = eventResult.status === 'fulfilled' ? eventResult.value : [];
    const result = {
      overdueTasks,
      dayGroups: buildDayGroups(
        startDate,
        getDateDistance(startDate, endExclusiveDate),
        dueTasks,
        events,
        this.config.timezone,
      ),
      todoistStatus,
      googleCalendarStatus,
    };

    await this.refreshTaskCache([...overdueTasks, ...dueTasks], todoistStatus.connected);
    await this.refreshEventCache(daysRemaining, googleCalendarStatus.connected);

    return result;
  }

  private async getCompletedTasksForRange(startUtc: string, endUtc: string) {
    if (!this.todoistClient.isConfigured()) {
      return [];
    }

    if (!(await this.todoistClient.isConnected())) {
      return [];
    }

    try {
      return await this.todoistClient.getCompletedTasksInRange(startUtc, endUtc);
    } catch (error) {
      this.logger?.warn('Completed task range fetch failed', {
        startUtc,
        endUtc,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
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
    } catch (error) {
      this.logger?.warn('Task cache refresh failed after review', {
        taskCount: tasks.length,
        error: error instanceof Error ? error.message : String(error),
      });
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
    } catch (error) {
      this.logger?.warn('Event cache refresh failed after review', {
        days,
        error: error instanceof Error ? error.message : String(error),
      });
      // Cache refresh should not break read views.
    }
  }
}

function getDateDistance(startDate: string, endExclusiveDate: string) {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endExclusiveDate}T00:00:00.000Z`);

  return Math.max(Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)), 1);
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
