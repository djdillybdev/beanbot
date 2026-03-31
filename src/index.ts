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
import { HabitRepository } from './db/habit-repository';
import { HabitCompletionRepository } from './db/habit-completion-repository';
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
  buildUndatedStatusEmbeds,
  buildUpcomingStatusEmbeds,
  buildWeekStatusEmbeds,
} from './bot/renderers/today';
import {
  buildHabitStatusSnapshot,
  buildPeriodStatusSnapshot,
  buildTodayStatusSnapshot,
  buildUndatedStatusSnapshot,
  buildUpcomingStatusSnapshot,
} from './app/today/status-snapshots';
import { LiveStatusService } from './app/today/today-status-service';
import { getLocalDateParts, getMonthBounds, getWeekBounds } from './utils/time';
import { HabitService } from './app/habits/habit-service';
import { startObsidianSyncRuntime } from './app/obsidian/obsidian-sync-runner';
import { ObsidianSyncStateRepository } from './db/obsidian-sync-state-repository';
import { buildOverallRuntimeSummary } from './runtime/diagnostics';
import { SubsystemHealthRegistry } from './runtime/subsystem-health';

async function main() {
  const config = createConfig();
  const logger = createLogger({
    consoleLevel: config.logLevel,
    discordLevel: config.discordLogLevel,
  });
  const startupLogger = logger.child({ subsystem: 'startup' });
  const healthRegistry = new SubsystemHealthRegistry();

  startupLogger.info('Starting Beanbot foundation services', {
    environment: config.env.NODE_ENV,
    timezone: config.timezone,
  });
  healthRegistry.markStarting('migrations', 'Applying database migrations.');
  const migrationResult = runMigrations(config);
  healthRegistry.markHealthy('migrations', 'Database migrations applied.', {
    databasePath: migrationResult.databasePath,
    verificationIssueCount: migrationResult.verification.issuesDetected.length,
    repairCount: migrationResult.repairsApplied.length,
    repairsApplied: migrationResult.repairsApplied,
  });
  startupLogger.info('Database migrations applied', {
    databasePath: migrationResult.databasePath,
    verificationIssueCount: migrationResult.verification.issuesDetected.length,
    repairCount: migrationResult.repairsApplied.length,
    repairsApplied: migrationResult.repairsApplied,
  });

  const db = createDb(config);
  const actionLogRepository = new ActionLogRepository(db);
  const tokenRepository = new OAuthTokenRepository(db);
  const todoistTaskMapRepository = new TodoistTaskMapRepository(db);
  const calendarEventMapRepository = new CalendarEventMapRepository(db);
  const habitRepository = new HabitRepository(db);
  const habitCompletionRepository = new HabitCompletionRepository(db);
  const reminderJobRepository = new ReminderJobRepository(db);
  const periodStatusMessageRepository = new PeriodStatusMessageRepository(db);
  const obsidianSyncStateRepository = new ObsidianSyncStateRepository(db);
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
  const obsidianSyncRuntime = await startObsidianSyncRuntime(
    config,
    db,
    todoistClient,
    logger,
    healthRegistry,
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
    habitRepository,
    habitCompletionRepository,
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
  const todayReviewService = new TodayReviewService(
    config,
    todoistClient,
    googleCalendarClient,
    todoistTaskMapRepository,
    habitService,
    taskService,
    eventService,
    logger.child({ subsystem: 'today-review' }),
  );

  healthRegistry.markStarting('command-registration', 'Registering guild commands.');
  try {
    await registerGuildCommands(config);
    healthRegistry.markHealthy('command-registration', 'Guild commands registered.', {
      guildId: config.env.DISCORD_GUILD_ID,
    });
    startupLogger.info('Guild commands registered', { guildId: config.env.DISCORD_GUILD_ID });
  } catch (error) {
    healthRegistry.markDegraded('command-registration', error, {
      guildId: config.env.DISCORD_GUILD_ID,
    });
    startupLogger.error('Guild command registration failed; continuing startup', error, {
      guildId: config.env.DISCORD_GUILD_ID,
    });
  }

  const server = createServer({
    config,
    migrationResult,
    tokenRepository,
    todoistTaskMapRepository,
    calendarEventMapRepository,
    habitRepository,
    reminderJobRepository,
    obsidianSyncStateRepository,
    todoistOAuthService,
    googleCalendarOAuthService,
    healthRegistry,
    logger: logger.child({ subsystem: 'server' }),
  });
  healthRegistry.markStarting('http-server', 'Starting HTTP server.');
  const httpServer = server.listen(config.port, config.host, () => {
    healthRegistry.markHealthy('http-server', 'HTTP server listening.', {
      host: config.host,
      port: config.port,
      publicBaseUrl: config.publicBaseUrl,
    });
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
  healthRegistry.markStarting('discord-client', 'Starting Discord client.');
  await discord.start();
  healthRegistry.markHealthy('discord-client', 'Discord client is ready.');
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
  const undatedStatusService = new LiveStatusService({
    client: discord.client,
    channelId: config.inboxChannelId,
    channelEnvName: 'INBOX_CHANNEL_ID',
    statusType: 'undated',
    repository: periodStatusMessageRepository,
    logger: logger.child({ subsystem: 'undated-status' }),
    getPeriodKey: () => 'undated',
    getReview: () => todayReviewService.getUndatedTaskReview(),
    buildSnapshot: buildUndatedStatusSnapshot,
    buildEmbeds: (periodKey, review, updatedAt) =>
      buildUndatedStatusEmbeds(config, periodKey, review, updatedAt),
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
      await undatedStatusService.refreshCurrentStatus(reason);
      await upcomingStatusService.refreshCurrentStatus(reason);
    }
  });
  healthRegistry.markStarting('status-bootstrap', 'Refreshing live status messages.');
  try {
    await weekStatusService.refreshCurrentStatus('startup');
    await monthStatusService.refreshCurrentStatus('startup');
    await habitsStatusService.refreshCurrentStatus('startup');
    await undatedStatusService.refreshCurrentStatus('startup');
    await upcomingStatusService.refreshCurrentStatus('startup');
    healthRegistry.markHealthy('status-bootstrap', 'Live status messages refreshed.');
  } catch (error) {
    healthRegistry.markDegraded('status-bootstrap', error);
    startupLogger.error('Live status bootstrap failed; continuing startup', error);
  }
  if (config.logsChannelId) {
    healthRegistry.markStarting('discord-log-sink', 'Attaching Discord log channel.');
    try {
      await logger.attachDiscordChannel(discord.client, config.logsChannelId, 'LOGS_CHANNEL_ID');
      healthRegistry.markHealthy('discord-log-sink', 'Discord log channel attached.', {
        channelId: config.logsChannelId,
      });
    } catch (error) {
      healthRegistry.markDegraded('discord-log-sink', error, {
        channelId: config.logsChannelId,
      });
      startupLogger.error('Failed to attach Discord log channel; continuing startup', error, {
        channelId: config.logsChannelId,
      });
    }
  } else {
    healthRegistry.markDisabled('discord-log-sink', 'LOGS_CHANNEL_ID is not configured.');
    startupLogger.warn('Discord log channel disabled because LOGS_CHANNEL_ID is not configured.');
  }
  healthRegistry.markStarting('today-digest-scheduler', 'Starting today digest scheduler.');
  const digestScheduler = startTodayDigestScheduler(
    config,
    todayStatusService,
    logger.child({ subsystem: 'today-digest' }),
  );
  healthRegistry.markHealthy('today-digest-scheduler', 'Today digest scheduler started.');
  healthRegistry.markStarting('status-refresh-schedulers', 'Starting live status refresh schedulers.');
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
  const undatedStatusRefreshScheduler = startTodayStatusRefreshScheduler(
    undatedStatusService,
    logger.child({ subsystem: 'undated-status-refresh' }),
    'undated',
  );
  const upcomingStatusRefreshScheduler = startTodayStatusRefreshScheduler(
    upcomingStatusService,
    logger.child({ subsystem: 'upcoming-status-refresh' }),
    'upcoming',
  );
  healthRegistry.markHealthy('status-refresh-schedulers', 'Live status refresh schedulers started.');
  healthRegistry.markStarting('reminder-scheduler', 'Starting reminder scheduler.');
  const reminderScheduler = startReminderScheduler(
    discord.client,
    reminderService,
    logger.child({ subsystem: 'reminder-scheduler' }),
  );
  healthRegistry.markHealthy('reminder-scheduler', 'Reminder scheduler started.');
  healthRegistry.setStartupComplete();
  const runtimeSummary = buildOverallRuntimeSummary(healthRegistry.getSnapshot());
  startupLogger.info('Startup sequence completed', {
    overallStatus: runtimeSummary.status,
    degradedSubsystems: runtimeSummary.degradedSubsystems,
    failedSubsystems: runtimeSummary.failedSubsystems,
    disabledSubsystemCount: runtimeSummary.disabledSubsystemCount,
  });

  const shutdown = async (signal: string) => {
    startupLogger.info('Received shutdown signal', { signal });
    digestScheduler.stop();
    todayStatusRefreshScheduler.stop();
    weekStatusRefreshScheduler.stop();
    monthStatusRefreshScheduler.stop();
    habitsStatusRefreshScheduler.stop();
    undatedStatusRefreshScheduler.stop();
    upcomingStatusRefreshScheduler.stop();
    reminderScheduler.stop();
    obsidianSyncRuntime.stop();
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
