import { createConfig } from '../../config';
import { createDb } from '../../db/client';
import { ActionLogRepository } from '../../db/action-log-repository';
import { CalendarEventMapRepository } from '../../db/calendar-event-map-repository';
import { TaskCompletionRepository } from '../../db/task-completion-repository';
import { inspectMigrationHealth } from '../../db/migrate';
import { OAuthTokenRepository } from '../../db/oauth-token-repository';
import { ObsidianNoteIndexRepository } from '../../db/obsidian-note-index-repository';
import { ObsidianSyncEventRepository } from '../../db/obsidian-sync-event-repository';
import { ObsidianSyncStateRepository } from '../../db/obsidian-sync-state-repository';
import { ObsidianTaskRepository } from '../../db/obsidian-task-repository';
import { ReminderJobRepository } from '../../db/reminder-job-repository';
import { TodoistTaskMapRepository } from '../../db/todoist-task-map-repository';
import { EventService } from '../events/event-service';
import { HabitService } from '../habits/habit-service';
import { ReminderService } from '../reminders/reminder-service';
import { TaskService } from '../tasks/task-service';
import { GoogleCalendarClient } from '../../integrations/google-calendar/client';
import { GoogleCalendarOAuthService } from '../../integrations/google-calendar/oauth';
import { TodoistClient } from '../../integrations/todoist/client';
import { createLogger } from '../../logging/logger';
import { SubsystemHealthRegistry } from '../../runtime/subsystem-health';
import { TodayStatusRefreshNotifier } from '../today/today-status-refresh-notifier';
import { OperatorService } from './operator-service';
import { createObsidianSyncContext } from '../obsidian/obsidian-sync-context';

export function createOperatorServiceForScript(subsystem = 'admin-script') {
  const config = createConfig();
  const db = createDb(config);
  const logger = createLogger({
    consoleLevel: config.logLevel,
    discordLevel: config.discordLogLevel,
  }).child({ subsystem });
  const healthRegistry = new SubsystemHealthRegistry();
  const migrationHealth = inspectMigrationHealth(config);
  const actionLogRepository = new ActionLogRepository(db);
  const tokenRepository = new OAuthTokenRepository(db);
  const todoistTaskMapRepository = new TodoistTaskMapRepository(db);
  const calendarEventMapRepository = new CalendarEventMapRepository(db);
  const taskCompletionRepository = new TaskCompletionRepository(db);
  const reminderJobRepository = new ReminderJobRepository(db);
  const obsidianTaskRepository = new ObsidianTaskRepository(db);
  const obsidianNoteIndexRepository = new ObsidianNoteIndexRepository(db);
  const obsidianSyncEventRepository = new ObsidianSyncEventRepository(db);
  const obsidianSyncStateRepository = new ObsidianSyncStateRepository(db);
  const todayStatusRefreshNotifier = new TodayStatusRefreshNotifier(logger.child({ subsystem: 'status-notifier' }));
  const todoistClient = new TodoistClient(config, tokenRepository);
  const googleCalendarOAuthService = new GoogleCalendarOAuthService(config);
  const googleCalendarClient = new GoogleCalendarClient(
    config,
    tokenRepository,
    googleCalendarOAuthService,
  );
  const reminderService = new ReminderService(
    config,
    reminderJobRepository,
    todoistClient,
    googleCalendarClient,
    logger.child({ subsystem: 'reminders' }),
  );
  const habitService = new HabitService(
    config.timezone,
    todoistTaskMapRepository,
    taskCompletionRepository,
    logger.child({ subsystem: 'habit' }),
  );
  const taskService = new TaskService(
    config.timezone,
    todoistClient,
    todoistTaskMapRepository,
    actionLogRepository,
    habitService,
    reminderService,
    todayStatusRefreshNotifier,
    logger.child({ subsystem: 'task' }),
  );
  const eventService = new EventService(
    googleCalendarClient,
    calendarEventMapRepository,
    actionLogRepository,
    config.timezone,
    reminderService,
    todayStatusRefreshNotifier,
    logger.child({ subsystem: 'event' }),
  );
  const obsidianContext = createObsidianSyncContext(
    config,
    db,
    todoistClient,
    logger.child({ subsystem: 'obsidian' }),
  );

  const operatorService = new OperatorService({
    config,
    db,
    migrationResult: {
      databasePath: config.databasePath,
      repairsApplied: [],
      verification: {
        issuesDetected: migrationHealth.issues,
        issuesRemaining: migrationHealth.issues,
      },
    },
    healthRegistry,
    actionLogRepository,
    todoistTaskMapRepository,
    calendarEventMapRepository,
    reminderJobRepository,
    obsidianTaskRepository,
    obsidianNoteIndexRepository,
    obsidianSyncEventRepository,
    obsidianSyncStateRepository,
    todoistClient,
    googleCalendarClient,
    taskService,
    eventService,
    reminderService,
    obsidianSyncRuntime: {
      stop() {},
      async runOnceNow() {
        await obsidianContext.syncService.runOnce();
      },
    },
    logger,
  });

  return {
    config,
    operatorService,
  };
}
