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
import { PeriodStatusMessageRepository } from './db/period-status-message-repository';
import { ReminderJobRepository } from './db/reminder-job-repository';
import { TodoistTaskMapRepository } from './db/todoist-task-map-repository';
import { GoogleCalendarClient } from './integrations/google-calendar/client';
import { GoogleCalendarOAuthService } from './integrations/google-calendar/oauth';
import { TodoistClient } from './integrations/todoist/client';
import { TodoistOAuthService } from './integrations/todoist/oauth';
import { startReminderScheduler } from './jobs/reminder-scheduler';
import { createLogger } from './logging/logger';
import { createServer } from './server/create-server';
import { TodayStatusRefreshNotifier } from './app/today/today-status-refresh-notifier';
import {
  buildHabitsStatusEmbeds,
  buildMonthStatusEmbeds,
  buildTodayStatusEmbeds,
  buildUpcomingStatusEmbeds,
  buildWeekStatusEmbeds,
} from './bot/renderers/today';
import {
  buildHabitStatusSnapshot,
  buildPeriodStatusSnapshot,
  buildTodayStatusSnapshot,
  buildUpcomingStatusSnapshot,
} from './app/today/status-snapshots';
import { LiveStatusService } from './app/today/today-status-service';
import { getLocalDateParts, getMonthBounds, getWeekBounds } from './utils/time';

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
  const periodStatusMessageRepository = new PeriodStatusMessageRepository(db);
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
    todoistTaskMapRepository,
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
  const todayStatusService = new LiveStatusService({
    client: discord.client,
    channelId: config.todayChannelId,
    channelEnvName: 'TODAY_CHANNEL_ID',
    statusType: 'today',
    repository: periodStatusMessageRepository,
    logger: logger.child({ subsystem: 'today-status' }),
    getPeriodKey: (now) => getLocalDateParts(now, config.timezone).date,
    getReview: (now) => todayReviewService.getReview(now),
    buildSnapshot: buildTodayStatusSnapshot,
    buildEmbeds: (periodKey, review, updatedAt) =>
      buildTodayStatusEmbeds(config, periodKey, review, updatedAt),
  });
  const weekStatusService = new LiveStatusService({
    client: discord.client,
    channelId: config.weekChannelId,
    channelEnvName: 'WEEK_CHANNEL_ID',
    statusType: 'week',
    repository: periodStatusMessageRepository,
    logger: logger.child({ subsystem: 'week-status' }),
    getPeriodKey: (now) => getWeekBounds(now, config.timezone).periodKey,
    getReview: (now) => todayReviewService.getWeekStatusReview(now),
    buildSnapshot: buildPeriodStatusSnapshot,
    buildEmbeds: (periodKey, review, updatedAt) =>
      buildWeekStatusEmbeds(config, periodKey, review, updatedAt),
  });
  const monthStatusService = new LiveStatusService({
    client: discord.client,
    channelId: config.monthChannelId,
    channelEnvName: 'MONTH_CHANNEL_ID',
    statusType: 'month',
    repository: periodStatusMessageRepository,
    logger: logger.child({ subsystem: 'month-status' }),
    getPeriodKey: (now) => getMonthBounds(now, config.timezone).periodKey,
    getReview: (now) => todayReviewService.getMonthStatusReview(now),
    buildSnapshot: buildPeriodStatusSnapshot,
    buildEmbeds: (periodKey, review, updatedAt) =>
      buildMonthStatusEmbeds(config, periodKey, review, updatedAt),
  });
  const habitsStatusService = new LiveStatusService({
    client: discord.client,
    channelId: config.habitsChannelId,
    channelEnvName: 'HABITS_CHANNEL_ID',
    statusType: 'habits',
    repository: periodStatusMessageRepository,
    logger: logger.child({ subsystem: 'habits-status' }),
    getPeriodKey: (now) => getLocalDateParts(now, config.timezone).date,
    getReview: (now) => todayReviewService.getHabitReview(now),
    buildSnapshot: buildHabitStatusSnapshot,
    buildEmbeds: (periodKey, review, updatedAt) =>
      buildHabitsStatusEmbeds(config, periodKey, review, updatedAt),
  });
  const upcomingStatusService = new LiveStatusService({
    client: discord.client,
    channelId: config.upcomingChannelId,
    channelEnvName: 'UPCOMING_CHANNEL_ID',
    statusType: 'upcoming',
    repository: periodStatusMessageRepository,
    logger: logger.child({ subsystem: 'upcoming-status' }),
    getPeriodKey: () => 'rolling-14d',
    getReview: (now) => todayReviewService.getUpcomingTaskStatusReview(now),
    buildSnapshot: buildUpcomingStatusSnapshot,
    buildEmbeds: (periodKey, review, updatedAt) =>
      buildUpcomingStatusEmbeds(config, periodKey, review, updatedAt),
    pinActiveMessage: false,
  });
  todayStatusRefreshNotifier.setHandler(async (reason) => {
    await todayStatusService.refreshCurrentStatus(reason);
    await weekStatusService.refreshCurrentStatus(reason);
    await monthStatusService.refreshCurrentStatus(reason);
    await habitsStatusService.refreshCurrentStatus(reason);
    if (reason.startsWith('task.')) {
      await upcomingStatusService.refreshCurrentStatus(reason);
    }
  });
  await weekStatusService.refreshCurrentStatus('startup');
  await monthStatusService.refreshCurrentStatus('startup');
  await habitsStatusService.refreshCurrentStatus('startup');
  await upcomingStatusService.refreshCurrentStatus('startup');
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
    'today',
  );
  const weekStatusRefreshScheduler = startTodayStatusRefreshScheduler(
    weekStatusService,
    logger.child({ subsystem: 'week-status-refresh' }),
    'week',
  );
  const monthStatusRefreshScheduler = startTodayStatusRefreshScheduler(
    monthStatusService,
    logger.child({ subsystem: 'month-status-refresh' }),
    'month',
  );
  const habitsStatusRefreshScheduler = startTodayStatusRefreshScheduler(
    habitsStatusService,
    logger.child({ subsystem: 'habits-status-refresh' }),
    'habits',
  );
  const upcomingStatusRefreshScheduler = startTodayStatusRefreshScheduler(
    upcomingStatusService,
    logger.child({ subsystem: 'upcoming-status-refresh' }),
    'upcoming',
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
    weekStatusRefreshScheduler.stop();
    monthStatusRefreshScheduler.stop();
    habitsStatusRefreshScheduler.stop();
    upcomingStatusRefreshScheduler.stop();
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
