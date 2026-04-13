import type { AppConfig } from '../../config';
import type { MigrationRunResult } from '../../db/migrate';
import { ObsidianNoteIndexRepository } from '../../db/obsidian-note-index-repository';
import { ObsidianSyncEventRepository } from '../../db/obsidian-sync-event-repository';
import { ObsidianSyncStateRepository } from '../../db/obsidian-sync-state-repository';
import {
  ObsidianTaskRepository,
  type ObsidianUnhealthyTaskRecord,
} from '../../db/obsidian-task-repository';
import { ReminderJobRepository } from '../../db/reminder-job-repository';
import { TodoistTaskMapRepository } from '../../db/todoist-task-map-repository';
import { CalendarEventMapRepository } from '../../db/calendar-event-map-repository';
import { ActionLogRepository } from '../../db/action-log-repository';
import { TodoistClient } from '../../integrations/todoist/client';
import { GoogleCalendarClient } from '../../integrations/google-calendar/client';
import type { Logger } from '../../logging/logger';
import {
  buildHabitDiagnostics,
  buildMigrationRuntimeSummary,
  buildObsidianDiagnostics,
  buildOverallRuntimeSummary,
  buildProviderStatus,
  buildReminderDiagnostics,
  enrichLatestUpdateSummary,
} from '../../runtime/diagnostics';
import type { SubsystemHealthRegistry } from '../../runtime/subsystem-health';
import type { TaskService } from '../tasks/task-service';
import type { EventService } from '../events/event-service';
import type { ReminderService } from '../reminders/reminder-service';
import type { ObsidianSyncRuntime } from '../obsidian/obsidian-sync-runner';
import { createObsidianSyncContext } from '../obsidian/obsidian-sync-context';
import type { Database } from '../../db/types';

const EVENT_CACHE_REBUILD_DAYS = 31;

export type ObsidianConflictKind =
  | 'duplicate_identity'
  | 'invalid_local_note'
  | 'push_failed'
  | 'delete_failed'
  | 'pending_push'
  | 'pending_delete'
  | 'unknown_conflict';

export type ObsidianResolveAction = 'retry-push' | 'retry-delete' | 're-export';

export interface ObsidianResetFromTodoistOptions {
  includeTaskCache?: boolean;
}

export interface ObsidianConflictSummary {
  taskId: string;
  title: string;
  syncStatus: string;
  taskStatus: string;
  kind: ObsidianConflictKind;
  repairable: boolean;
  recommendedAction?: ObsidianResolveAction;
  summary: string;
  filePath?: string;
  lastEventType?: string;
  lastEventAtUtc?: string;
}

interface OperatorServiceDependencies {
  config: AppConfig;
  db: Database;
  migrationResult: MigrationRunResult;
  healthRegistry: SubsystemHealthRegistry;
  actionLogRepository: ActionLogRepository;
  todoistTaskMapRepository: TodoistTaskMapRepository;
  calendarEventMapRepository: CalendarEventMapRepository;
  reminderJobRepository: ReminderJobRepository;
  obsidianTaskRepository: ObsidianTaskRepository;
  obsidianNoteIndexRepository: ObsidianNoteIndexRepository;
  obsidianSyncEventRepository: ObsidianSyncEventRepository;
  obsidianSyncStateRepository: ObsidianSyncStateRepository;
  todoistClient: TodoistClient;
  googleCalendarClient: GoogleCalendarClient;
  taskService: TaskService;
  eventService: EventService;
  reminderService: ReminderService;
  obsidianSyncRuntime: ObsidianSyncRuntime;
  logger: Logger;
}

export class OperatorService {
  constructor(private readonly dependencies: OperatorServiceDependencies) {}

  async getHealthSnapshot() {
    const {
      config,
      migrationResult,
      healthRegistry,
      todoistTaskMapRepository,
      calendarEventMapRepository,
      reminderJobRepository,
      obsidianSyncStateRepository,
      todoistClient,
      googleCalendarClient,
    } = this.dependencies;
    const [taskCache, eventCache, habitSummary, reminderSummary, obsidianState, todoistConnected, googleConnected] =
      await Promise.all([
        todoistTaskMapRepository.getCacheSummary(),
        calendarEventMapRepository.getCacheSummary(),
        todoistTaskMapRepository.getHabitSummary(),
        reminderJobRepository.getSummary(),
        obsidianSyncStateRepository.getState(),
        todoistClient.isConnected(),
        googleCalendarClient.isConnected(),
      ]);
    const runtime = healthRegistry.getSnapshot();

    return {
      status: runtime.status,
      overall: buildOverallRuntimeSummary(runtime),
      service: 'beanbot',
      environment: config.env.NODE_ENV,
      guildId: config.env.DISCORD_GUILD_ID,
      startedAtUtc: runtime.startedAtUtc,
      startupComplete: runtime.startupComplete,
      todoistConnected,
      googleCalendarConnected: googleConnected,
      providers: {
        todoist: buildProviderStatus(todoistConnected),
        googleCalendar: buildProviderStatus(googleConnected),
      },
      migration: buildMigrationRuntimeSummary(migrationResult),
      subsystems: runtime.subsystems,
      caches: {
        tasks: enrichLatestUpdateSummary(taskCache, 60 * 30),
        events: enrichLatestUpdateSummary(eventCache, 60 * 30),
      },
      habits: buildHabitDiagnostics(habitSummary),
      reminders: buildReminderDiagnostics(reminderSummary),
      obsidian: buildObsidianDiagnostics(obsidianState ?? null, {
        enabled: Boolean(config.obsidianVaultPath),
        pollIntervalSeconds: config.obsidianSyncPollIntervalSeconds,
        runtimeSubsystem: runtime.subsystems['obsidian-sync'],
      }),
      timestamp: new Date().toISOString(),
    };
  }

  async inspectCaches() {
    const [tasks, events] = await Promise.all([
      this.dependencies.todoistTaskMapRepository.getCacheSummary(),
      this.dependencies.calendarEventMapRepository.getCacheSummary(),
    ]);

    return {
      timestamp: new Date().toISOString(),
      tasks: enrichLatestUpdateSummary(tasks, 60 * 30),
      events: enrichLatestUpdateSummary(events, 60 * 30),
    };
  }

  async rebuildCaches(target: 'tasks' | 'events' | 'all' = 'all') {
    const startedAt = Date.now();
    let taskCount = 0;
    let eventCount = 0;

    if (target === 'tasks' || target === 'all') {
      const tasks = await this.dependencies.todoistClient.getAllActiveTaskRecords();
      await this.dependencies.taskService.rememberTasks(tasks);
      taskCount = tasks.length;
    }

    if (target === 'events' || target === 'all') {
      const events = await this.dependencies.googleCalendarClient.getEventRecordsForUpcomingDays(EVENT_CACHE_REBUILD_DAYS);
      await this.dependencies.eventService.rememberEvents(events);
      eventCount = events.length;
    }

    const result = {
      action: 'cache.rebuild',
      target,
      taskCount,
      eventCount,
      durationMs: Date.now() - startedAt,
      result: 'success' as const,
      summary: `Rebuilt ${taskCount} task cache entries and ${eventCount} event cache entries.`,
    };

    await this.logOperatorAction('/admin cache rebuild', { target }, result);
    return result;
  }

  async inspectReminders() {
    const [summary, failedJobs] = await Promise.all([
      this.dependencies.reminderJobRepository.getSummary(),
      this.dependencies.reminderJobRepository.listByStatus('failed', 10),
    ]);

    return {
      timestamp: new Date().toISOString(),
      summary: buildReminderDiagnostics(summary),
      failedJobs,
    };
  }

  async retryFailedReminders() {
    const before = await this.dependencies.reminderJobRepository.listByStatus('failed', 100);
    await this.dependencies.reminderService.retryFailedReminders();
    const afterSummary = await this.dependencies.reminderJobRepository.getSummary();

    const result = {
      action: 'reminders.retry_failed',
      retriedCount: before.length,
      summary: buildReminderDiagnostics(afterSummary),
      result: 'success' as const,
    };

    await this.logOperatorAction('/admin reminders retry-failed', { failedBefore: before.length }, result);
    return result;
  }

  async getObsidianStatus() {
    const [state, recentEvents, conflicts, health] = await Promise.all([
      this.dependencies.obsidianSyncStateRepository.getState(),
      this.dependencies.obsidianSyncEventRepository.listRecent(10),
      this.listObsidianConflicts(),
      this.getHealthSnapshot(),
    ]);

    return {
      timestamp: new Date().toISOString(),
      diagnostics: health.obsidian,
      runtimeSubsystem: health.subsystems['obsidian-sync'] ?? null,
      state,
      recentEvents,
      conflicts,
    };
  }

  async listObsidianConflicts(): Promise<ObsidianConflictSummary[]> {
    const tasks = await this.dependencies.obsidianTaskRepository.listUnhealthy(50);
    const taskIds = tasks.map((task) => task.todoistTaskId);
    const [events, noteIndexes] = await Promise.all([
      this.dependencies.obsidianSyncEventRepository.listRecentByTaskIds(taskIds, 200),
      Promise.all(taskIds.map((taskId) => this.dependencies.obsidianNoteIndexRepository.findByTaskId(taskId))),
    ]);

    const latestEventByTaskId = new Map<string, (typeof events)[number]>();
    for (const event of events) {
      if (!event.todoistTaskId || latestEventByTaskId.has(event.todoistTaskId)) {
        continue;
      }

      latestEventByTaskId.set(event.todoistTaskId, event);
    }

    const noteIndexByTaskId = new Map(
      noteIndexes.filter((entry): entry is NonNullable<typeof entry> => entry !== undefined && entry !== null)
        .map((entry) => [entry.todoistTaskId, entry]),
    );

    return tasks.map((task) =>
      summarizeConflict(
        task,
        latestEventByTaskId.get(task.todoistTaskId),
        noteIndexByTaskId.get(task.todoistTaskId)?.filePath,
      ));
  }

  async runObsidianSyncOnce() {
    const startedAt = Date.now();
    await this.dependencies.obsidianSyncRuntime.runOnceNow();
    const state = await this.dependencies.obsidianSyncStateRepository.getState();

    const result = {
      action: 'obsidian.sync_once',
      durationMs: Date.now() - startedAt,
      state,
      result: 'success' as const,
    };

    await this.logOperatorAction('/admin obsidian sync-once', undefined, result);
    return result;
  }

  async resetObsidianFromTodoist(options: ObsidianResetFromTodoistOptions = {}) {
    const startedAt = Date.now();
    const resetResult = await this.dependencies.obsidianSyncRuntime.resetFromTodoist();
    let taskCacheRebuiltCount = 0;

    if (options.includeTaskCache) {
      await this.dependencies.todoistTaskMapRepository.deleteAll();
      const activeTasks = await this.dependencies.todoistClient.getAllActiveTaskRecords();
      await this.dependencies.taskService.rememberTasks(activeTasks);
      taskCacheRebuiltCount = activeTasks.length;
    }

    const result = {
      ...resetResult,
      includeTaskCache: options.includeTaskCache ?? false,
      taskCacheRebuiltCount,
      totalDurationMs: Date.now() - startedAt,
    };

    await this.logOperatorAction('admin:obsidian:reset-from-todoist', options, result);
    return result;
  }

  async resolveObsidianConflict(taskId: string, action: ObsidianResolveAction) {
    const unhealthyTask = await this.dependencies.obsidianTaskRepository.getByTaskId(taskId);

    if (!unhealthyTask) {
      throw new Error(`No tracked Obsidian task found for ${taskId}.`);
    }

    const latestEvent = (await this.dependencies.obsidianSyncEventRepository.listRecentByTaskId(taskId, 1))[0] ?? null;
    const conflict = summarizeConflict(
      { ...unhealthyTask, dbUpdatedAtUtc: undefined },
      latestEvent,
      (await this.dependencies.obsidianNoteIndexRepository.findByTaskId(taskId))?.filePath,
    );

    if (!conflict.repairable && action !== 're-export') {
      throw new Error(`Conflict kind ${conflict.kind} requires manual intervention.`);
    }

    let result: Record<string, unknown>;
    if (action === 'retry-push') {
      result = await this.obsidianContext.pendingPushService.retryTask(taskId);
      await this.dependencies.obsidianSyncEventRepository.insert({
        eventType: 'admin_repair_push_completed',
        source: 'system',
        todoistTaskId: taskId,
        payloadSummary: JSON.stringify({ requestedAction: action }),
        result: 'success',
      });
    } else if (action === 'retry-delete') {
      result = await this.obsidianContext.pendingDeleteService.retryTask(taskId);
      await this.dependencies.obsidianSyncEventRepository.insert({
        eventType: 'admin_repair_delete_completed',
        source: 'system',
        todoistTaskId: taskId,
        payloadSummary: JSON.stringify({ requestedAction: action }),
        result: 'success',
      });
    } else {
      result = await this.reExportObsidianTask(taskId);
    }

    const outcome = {
      action: 'obsidian.resolve',
      taskId,
      requestedAction: action,
      conflictKind: conflict.kind,
      result: 'success' as const,
      details: result,
    };

    await this.logOperatorAction('/admin obsidian resolve', { taskId, action }, outcome);
    return outcome;
  }

  private async reExportObsidianTask(taskId: string) {
    const task = await this.dependencies.obsidianTaskRepository.getByTaskId(taskId);

    if (!task) {
      throw new Error(`No tracked Obsidian task found for ${taskId}.`);
    }

    if (task.taskStatus === 'deleted') {
      throw new Error('Deleted tasks cannot be re-exported.');
    }

    const existingIndex = await this.dependencies.obsidianNoteIndexRepository.findByTaskId(taskId);
    const exportResult = await this.obsidianContext.vaultAdapter.exportTask(
      task,
      existingIndex?.filePath ?? null,
    );

    await this.dependencies.obsidianNoteIndexRepository.upsert({
      todoistTaskId: task.todoistTaskId,
      filePath: exportResult.relativePath,
      contentHash: exportResult.contentHash,
      metadataHash: exportResult.metadataHash,
      lastFileMtimeUtc: exportResult.lastFileMtimeUtc,
    });
    await this.dependencies.obsidianTaskRepository.updateExportMetadata(task.todoistTaskId, {
      contentHash: exportResult.metadataHash,
      noteBody: exportResult.noteBody,
    });
    await this.dependencies.obsidianTaskRepository.markSynced(task.todoistTaskId, 'system');
    await this.dependencies.obsidianSyncEventRepository.insert({
      eventType: 'admin_reexport_completed',
      source: 'system',
      todoistTaskId: task.todoistTaskId,
      payloadSummary: JSON.stringify({
        relativePath: exportResult.relativePath,
        didWrite: exportResult.didWrite,
      }),
      result: 'success',
    });

    return {
      relativePath: exportResult.relativePath,
      didWrite: exportResult.didWrite,
    };
  }

  private async logOperatorAction(sourceCommand: string, payload: unknown, result: unknown) {
    await this.dependencies.actionLogRepository.insert({
      actionType: 'admin.operator_action',
      sourceCommand,
      payloadJson: payload === undefined ? null : JSON.stringify(payload),
      resultJson: JSON.stringify(result),
    });
  }

  private get obsidianContext() {
    return createObsidianSyncContext(
      this.dependencies.config,
      this.dependencies.db,
      this.dependencies.todoistClient,
      this.dependencies.logger.child({ subsystem: 'operator-obsidian' }),
    );
  }
}

export function summarizeConflict(
  task: ObsidianUnhealthyTaskRecord,
  latestEvent?: {
    eventType: string;
    payloadSummary: string | null;
    createdAtUtc: string;
  } | null,
  filePath?: string,
): ObsidianConflictSummary {
  const eventType = latestEvent?.eventType;

  if (eventType === 'local_note_duplicate_identity') {
    return {
      taskId: task.todoistTaskId,
      title: task.content,
      syncStatus: task.syncStatus,
      taskStatus: task.taskStatus,
      kind: 'duplicate_identity',
      repairable: false,
      summary: 'Multiple note files claim the same Todoist task id.',
      filePath,
      lastEventType: eventType,
      lastEventAtUtc: latestEvent?.createdAtUtc,
    };
  }

  if (eventType === 'local_change_invalid' || eventType === 'local_note_create_invalid') {
    return {
      taskId: task.todoistTaskId,
      title: task.content,
      syncStatus: task.syncStatus,
      taskStatus: task.taskStatus,
      kind: 'invalid_local_note',
      repairable: true,
      recommendedAction: 're-export',
      summary: 'Local note data is invalid and should be overwritten with canonical exported content.',
      filePath,
      lastEventType: eventType,
      lastEventAtUtc: latestEvent?.createdAtUtc,
    };
  }

  if (eventType === 'push.failed' || task.syncStatus === 'pending_push') {
    return {
      taskId: task.todoistTaskId,
      title: task.content,
      syncStatus: task.syncStatus,
      taskStatus: task.taskStatus,
      kind: eventType === 'push.failed' ? 'push_failed' : 'pending_push',
      repairable: true,
      recommendedAction: 'retry-push',
      summary: 'Local Obsidian changes are waiting to be pushed to Todoist.',
      filePath,
      lastEventType: eventType,
      lastEventAtUtc: latestEvent?.createdAtUtc,
    };
  }

  if (eventType === 'delete.failed' || task.syncStatus === 'pending_delete') {
    return {
      taskId: task.todoistTaskId,
      title: task.content,
      syncStatus: task.syncStatus,
      taskStatus: task.taskStatus,
      kind: eventType === 'delete.failed' ? 'delete_failed' : 'pending_delete',
      repairable: true,
      recommendedAction: 'retry-delete',
      summary: 'A local note deletion still needs to be reconciled in Todoist.',
      filePath,
      lastEventType: eventType,
      lastEventAtUtc: latestEvent?.createdAtUtc,
    };
  }

  return {
    taskId: task.todoistTaskId,
    title: task.content,
    syncStatus: task.syncStatus,
    taskStatus: task.taskStatus,
    kind: 'unknown_conflict',
    repairable: task.syncStatus === 'error',
    recommendedAction: task.syncStatus === 'error' ? 're-export' : undefined,
    summary: 'Tracked Obsidian task needs review before it can return to synced state.',
    filePath,
    lastEventType: eventType,
    lastEventAtUtc: latestEvent?.createdAtUtc,
  };
}
