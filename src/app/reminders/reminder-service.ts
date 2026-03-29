import type { Client } from 'discord.js';

import type { AppConfig } from '../../config';
import { ReminderJobRepository } from '../../db/reminder-job-repository';
import type {
  EventUpcomingReminderPayload,
  TaskDueSoonReminderPayload,
  TaskOverdueReminderPayload,
} from '../../domain/reminder';
import type { GoogleCalendarEventRecord } from '../../domain/event';
import type { TodoistTaskRecord } from '../../domain/task';
import { GoogleCalendarClient } from '../../integrations/google-calendar/client';
import { TodoistClient } from '../../integrations/todoist/client';
import { parseLocalDateTimeInput, getLocalDateParts } from '../../utils/time';
import {
  buildOverdueReminderBatchMessage,
  buildReminderMessage,
} from '../../bot/renderers/reminder';
import { resolveTextChannel } from '../../jobs/resolve-text-channel';

const OVERDUE_TASK_DAILY_REMINDER_HOUR = 9;
const TASK_DUE_SOON_OFFSET_MS = 60 * 60 * 1000;
const EVENT_UPCOMING_OFFSET_MS = 30 * 60 * 1000;
const UPCOMING_SYNC_DAYS = 2;
const FINISHED_JOB_RETENTION_DAYS = 7;

export class ReminderService {
  constructor(
    private readonly config: AppConfig,
    private readonly reminderJobRepository: ReminderJobRepository,
    private readonly todoistClient: TodoistClient,
    private readonly googleCalendarClient: GoogleCalendarClient,
  ) {}

  async syncUpcomingReminders(now = new Date()) {
    const [todoistConnected, googleConnected] = await Promise.all([
      this.todoistClient.isConnected(),
      this.googleCalendarClient.isConnected(),
    ]);
    const [tasks, events] = await Promise.all([
      todoistConnected
        ? this.todoistClient.getTaskRecordsForUpcomingDays(UPCOMING_SYNC_DAYS)
        : Promise.resolve([]),
      googleConnected
        ? this.googleCalendarClient.getEventRecordsForUpcomingDays(UPCOMING_SYNC_DAYS)
        : Promise.resolve([]),
    ]);

    for (const task of tasks) {
      await this.syncTask(task, now);
    }

    for (const event of events) {
      await this.syncEvent(event, now);
    }
  }

  async syncTask(task: TodoistTaskRecord, now = new Date()) {
    await this.reminderJobRepository.cancelPendingJobsForSource('task', task.id);

    if (task.taskStatus !== 'active') {
      return;
    }

    const localToday = getLocalDateParts(now, this.config.timezone).date;

    if (task.dueDate && task.dueDate < localToday) {
      const payload: TaskOverdueReminderPayload = {
        kind: 'task_overdue',
        title: task.title,
        projectName: task.projectName,
        dueLabel: task.dueLabel,
        priority: task.priority,
        url: task.url,
        localDate: localToday,
      };

      await this.reminderJobRepository.upsertPendingJob({
        id: `task_overdue:${task.id}:${localToday}`,
        sourceType: 'task',
        sourceId: task.id,
        reminderKind: 'task_overdue',
        dedupeKey: `task_overdue:${task.id}:${localToday}`,
        remindAtUtc: parseLocalDateTimeInput(
          `${localToday} ${String(OVERDUE_TASK_DAILY_REMINDER_HOUR).padStart(2, '0')}:00`,
          this.config.timezone,
        ).toISOString(),
        channelId: this.config.remindersChannelId,
        payload,
      });
    }

    if (!task.dueDateTimeUtc) {
      return;
    }

    const dueAt = new Date(task.dueDateTimeUtc);
    const remindAt = new Date(dueAt.getTime() - TASK_DUE_SOON_OFFSET_MS);

    if (dueAt <= now) {
      return;
    }

    const payload: TaskDueSoonReminderPayload = {
      kind: 'task_due_soon',
      title: task.title,
      projectName: task.projectName,
      priority: task.priority,
      dueDateTimeUtc: task.dueDateTimeUtc,
      dueLabel: task.dueLabel,
      url: task.url,
    };

    await this.reminderJobRepository.upsertPendingJob({
      id: `task_due_soon:${task.id}:${task.dueDateTimeUtc}`,
      sourceType: 'task',
      sourceId: task.id,
      reminderKind: 'task_due_soon',
      dedupeKey: `task_due_soon:${task.id}:${task.dueDateTimeUtc}`,
      remindAtUtc: remindAt.toISOString(),
      channelId: this.config.remindersChannelId,
      payload,
    });
  }

  async cancelTaskReminders(taskId: string) {
    await this.reminderJobRepository.cancelPendingJobsForSource('task', taskId);
  }

  async syncEvent(event: GoogleCalendarEventRecord, now = new Date()) {
    await this.reminderJobRepository.cancelPendingJobsForSource('event', event.id);

    if (event.eventStatus !== 'active' || event.isRecurring) {
      return;
    }

    const startAt = new Date(event.startUtc);
    const remindAt = new Date(startAt.getTime() - EVENT_UPCOMING_OFFSET_MS);

    if (remindAt < now) {
      return;
    }

    const payload: EventUpcomingReminderPayload = {
      kind: 'event_upcoming',
      title: event.title,
      startUtc: event.startUtc,
      startLabel: event.startLabel,
      location: event.location,
      url: event.url,
    };

    await this.reminderJobRepository.upsertPendingJob({
      id: `event_upcoming:${event.id}:${event.startUtc}`,
      sourceType: 'event',
      sourceId: event.id,
      reminderKind: 'event_upcoming',
      dedupeKey: `event_upcoming:${event.id}:${event.startUtc}`,
      remindAtUtc: remindAt.toISOString(),
      channelId: this.config.remindersChannelId,
      payload,
    });
  }

  async cancelEventReminders(eventId: string) {
    await this.reminderJobRepository.cancelPendingJobsForSource('event', eventId);
  }

  async deliverDueReminders(client: Client, logger: Pick<Console, 'info' | 'error'>, now = new Date()) {
    const dueJobs = await this.reminderJobRepository.listDuePendingJobs(now.toISOString());

    if (dueJobs.length === 0) {
      return;
    }

    const channel = await resolveTextChannel(client, this.config.remindersChannelId, 'REMINDERS_CHANNEL_ID');
    const overdueJobs = dueJobs.filter((job) => job.reminderKind === 'task_overdue');
    const nonOverdueJobs = dueJobs.filter((job) => job.reminderKind !== 'task_overdue');

    if (overdueJobs.length > 0) {
      try {
        await channel.send({
          content: buildOverdueReminderBatchMessage(
            overdueJobs.map((job) => job.payload as TaskOverdueReminderPayload),
          ),
        });

        const deliveredAtUtc = new Date().toISOString();
        for (const job of overdueJobs) {
          await this.reminderJobRepository.markDelivered(job.id, deliveredAtUtc);
          logger.info(`Delivered reminder ${job.id}`);
        }
      } catch (error) {
        logger.error('Failed to deliver overdue reminder batch', error);
        for (const job of overdueJobs) {
          await this.reminderJobRepository.markFailed(job.id);
        }
      }
    }

    for (const job of nonOverdueJobs) {
      try {
        await channel.send({
          content: buildReminderMessage(job.payload, this.config.timezone),
        });
        await this.reminderJobRepository.markDelivered(job.id, new Date().toISOString());
        logger.info(`Delivered reminder ${job.id}`);
      } catch (error) {
        logger.error(`Failed to deliver reminder ${job.id}`, error);
        await this.reminderJobRepository.markFailed(job.id);
      }
    }
  }

  async retryFailedReminders(now = new Date()) {
    await this.reminderJobRepository.resetFailedJobs(now.toISOString());
  }

  async pruneFinishedReminders(now = new Date()) {
    const cutoff = new Date(now.getTime() - FINISHED_JOB_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    await this.reminderJobRepository.pruneFinishedJobs(cutoff.toISOString());
  }
}

export type ReminderLogger = Pick<Console, 'info' | 'error'>;
