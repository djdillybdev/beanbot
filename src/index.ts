import { EventService } from './app/events/event-service';
import { TodayReviewService } from './app/today/get-today-review';
import { TaskService } from './app/tasks/task-service';
import { createConfig } from './config';
import { createDb } from './db/client';
import { createDiscordClient } from './bot/client';
import { EventDraftStore } from './bot/event-draft-store';
import { startTodayDigestScheduler } from './jobs/today-digest-scheduler';
import { registerGuildCommands } from './bot/register-commands';
import { ActionLogRepository } from './db/action-log-repository';
import { CalendarEventMapRepository } from './db/calendar-event-map-repository';
import { runMigrations } from './db/migrate';
import { OAuthTokenRepository } from './db/oauth-token-repository';
import { TodoistTaskMapRepository } from './db/todoist-task-map-repository';
import { GoogleCalendarClient } from './integrations/google-calendar/client';
import { GoogleCalendarOAuthService } from './integrations/google-calendar/oauth';
import { TodoistClient } from './integrations/todoist/client';
import { TodoistOAuthService } from './integrations/todoist/oauth';
import { createServer } from './server/create-server';

async function main() {
  const config = createConfig();

  console.info('Starting Beanbot foundation services');
  runMigrations(config);
  console.info(`Database migrations applied at ${config.databasePath}`);

  const db = createDb(config);
  const actionLogRepository = new ActionLogRepository(db);
  const tokenRepository = new OAuthTokenRepository(db);
  const todoistTaskMapRepository = new TodoistTaskMapRepository(db);
  const calendarEventMapRepository = new CalendarEventMapRepository(db);
  const eventDraftStore = new EventDraftStore();
  const todoistOAuthService = new TodoistOAuthService(config);
  const googleCalendarOAuthService = new GoogleCalendarOAuthService(config);
  const todoistClient = new TodoistClient(config, tokenRepository);
  const googleCalendarClient = new GoogleCalendarClient(
    config,
    tokenRepository,
    googleCalendarOAuthService,
  );
  const taskService = new TaskService(
    todoistClient,
    todoistTaskMapRepository,
    actionLogRepository,
  );
  const eventService = new EventService(
    googleCalendarClient,
    calendarEventMapRepository,
    actionLogRepository,
    config.timezone,
  );
  const todayReviewService = new TodayReviewService(
    config,
    todoistClient,
    googleCalendarClient,
    taskService,
    eventService,
  );

  await registerGuildCommands(config);
  console.info(`Guild commands registered for guild ${config.env.DISCORD_GUILD_ID}`);

  const server = createServer({
    config,
    tokenRepository,
    todoistOAuthService,
    googleCalendarOAuthService,
  });
  const httpServer = server.listen(config.port, config.host, () => {
    console.info(`Express server listening on http://${config.host}:${config.port}`);
  });

  const discord = createDiscordClient(console, {
    config,
    todayReviewService,
    taskService,
    eventService,
    eventDraftStore,
  });
  await discord.start();
  const digestScheduler = startTodayDigestScheduler(
    discord.client,
    config,
    todayReviewService,
    console,
  );

  const shutdown = async (signal: string) => {
    console.info(`Received ${signal}, shutting down`);
    digestScheduler.stop();
    httpServer.close();
    await discord.client.destroy();
    process.exit(0);
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error('Beanbot failed to start', error);
  process.exit(1);
});
