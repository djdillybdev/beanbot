import { EventService } from './app/events/event-service';
import { ReminderService } from './app/reminders/reminder-service';
import { TodayReviewService } from './app/today/get-today-review';
import { TaskService } from './app/tasks/task-service';
import { createConfig } from './config';
import { createDb } from './db/client';
import { createDiscordClient } from './bot/client';
import { EventDraftStore } from './bot/event-draft-store';
import { startTodayDigestScheduler } from './jobs/today-digest-scheduler';
import { startTodayStatusRefreshScheduler } from './jobs/today-status-refresh-scheduler';
import { registerGuildCommands } from './bot/register-commands';
import { ActionLogRepository } from './db/action-log-repository';
import { CalendarEventMapRepository } from './db/calendar-event-map-repository';
import { runMigrations } from './db/migrate';
import { OAuthTokenRepository } from './db/oauth-token-repository';
import { ReminderJobRepository } from './db/reminder-job-repository';
import { TodayStatusMessageRepository } from './db/today-status-message-repository';
import { TodoistTaskMapRepository } from './db/todoist-task-map-repository';
import { GoogleCalendarClient } from './integrations/google-calendar/client';
import { GoogleCalendarOAuthService } from './integrations/google-calendar/oauth';
import { TodoistClient } from './integrations/todoist/client';
import { TodoistOAuthService } from './integrations/todoist/oauth';
import { startReminderScheduler } from './jobs/reminder-scheduler';
import { createLogger } from './logging/logger';
import { createServer } from './server/create-server';
import { TodayStatusRefreshNotifier } from './app/today/today-status-refresh-notifier';
import { TodayStatusService } from './app/today/today-status-service';

async function main() {
  const config = createConfig();
  const logger = createLogger({
    consoleLevel: config.logLevel,
    discordLevel: config.discordLogLevel,
  });
  const startupLogger = logger.child({ subsystem: 'startup' });

  startupLogger.info('Starting Beanbot foundation services', {
    environment: config.env.NODE_ENV,
    timezone: config.timezone,
  });
  runMigrations(config);
  startupLogger.info('Database migrations applied', { databasePath: config.databasePath });

  const db = createDb(config);
  const actionLogRepository = new ActionLogRepository(db);
  const tokenRepository = new OAuthTokenRepository(db);
  const todoistTaskMapRepository = new TodoistTaskMapRepository(db);
  const calendarEventMapRepository = new CalendarEventMapRepository(db);
  const reminderJobRepository = new ReminderJobRepository(db);
  const todayStatusMessageRepository = new TodayStatusMessageRepository(db);
  const eventDraftStore = new EventDraftStore();
  const todayStatusRefreshNotifier = new TodayStatusRefreshNotifier(
    logger.child({ subsystem: 'today-status-refresh-notifier' }),
  );
  const todoistOAuthService = new TodoistOAuthService(config);
  const googleCalendarOAuthService = new GoogleCalendarOAuthService(config);
  const todoistClient = new TodoistClient(config, tokenRepository);
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
  const taskService = new TaskService(
    todoistClient,
    todoistTaskMapRepository,
    actionLogRepository,
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
  const todayReviewService = new TodayReviewService(
    config,
    todoistClient,
    googleCalendarClient,
    taskService,
    eventService,
    logger.child({ subsystem: 'today-review' }),
  );

  await registerGuildCommands(config);
  startupLogger.info('Guild commands registered', { guildId: config.env.DISCORD_GUILD_ID });

  const server = createServer({
    config,
    tokenRepository,
    todoistOAuthService,
    googleCalendarOAuthService,
    logger: logger.child({ subsystem: 'server' }),
  });
  const httpServer = server.listen(config.port, config.host, () => {
    startupLogger.info('Express server listening', {
      host: config.host,
      port: config.port,
      publicBaseUrl: config.publicBaseUrl,
    });
  });

  const discord = createDiscordClient(logger.child({ subsystem: 'discord' }), {
    config,
    todayReviewService,
    taskService,
    eventService,
    eventDraftStore,
    logger: logger.child({ subsystem: 'bot-handlers' }),
  });
  await discord.start();
  const todayStatusService = new TodayStatusService(
    discord.client,
    config,
    todayReviewService,
    todayStatusMessageRepository,
    logger.child({ subsystem: 'today-status' }),
  );
  todayStatusRefreshNotifier.setHandler((reason) =>
    todayStatusService.refreshCurrentDayStatus(reason),
  );
  if (config.logsChannelId) {
    await logger.attachDiscordChannel(discord.client, config.logsChannelId, 'LOGS_CHANNEL_ID');
  } else {
    startupLogger.warn('Discord log channel disabled because LOGS_CHANNEL_ID is not configured.');
  }
  const digestScheduler = startTodayDigestScheduler(
    config,
    todayStatusService,
    logger.child({ subsystem: 'today-digest' }),
  );
  const todayStatusRefreshScheduler = startTodayStatusRefreshScheduler(
    todayStatusService,
    logger.child({ subsystem: 'today-status-refresh' }),
  );
  const reminderScheduler = startReminderScheduler(
    discord.client,
    reminderService,
    logger.child({ subsystem: 'reminder-scheduler' }),
  );

  const shutdown = async (signal: string) => {
    startupLogger.info('Received shutdown signal', { signal });
    digestScheduler.stop();
    todayStatusRefreshScheduler.stop();
    reminderScheduler.stop();
    httpServer.close();
    await discord.client.destroy();
    process.exit(0);
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  const fallbackLogger = createLogger({
    consoleLevel: 'debug',
    discordLevel: 'error',
  });
  fallbackLogger.error('Beanbot failed to start', error, { subsystem: 'startup' });
  process.exit(1);
});
