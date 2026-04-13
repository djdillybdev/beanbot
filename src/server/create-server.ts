import express from 'express';

import type { AppConfig } from '../config';
import type { MigrationRunResult } from '../db/migrate';
import { OAuthTokenRepository } from '../db/oauth-token-repository';
import { CalendarEventMapRepository } from '../db/calendar-event-map-repository';
import { ObsidianSyncStateRepository } from '../db/obsidian-sync-state-repository';
import { ReminderJobRepository } from '../db/reminder-job-repository';
import { TodoistTaskMapRepository } from '../db/todoist-task-map-repository';
import { GoogleCalendarOAuthService } from '../integrations/google-calendar/oauth';
import { TodoistOAuthService } from '../integrations/todoist/oauth';
import type { Logger } from '../logging/logger';
import {
  buildHabitDiagnostics,
  buildMigrationRuntimeSummary,
  buildObsidianDiagnostics,
  buildOverallRuntimeSummary,
  buildProviderStatus,
  buildReminderDiagnostics,
  enrichLatestUpdateSummary,
} from '../runtime/diagnostics';
import type { SubsystemHealthRegistry } from '../runtime/subsystem-health';

interface CreateServerDependencies {
  config: AppConfig;
  migrationResult: MigrationRunResult;
  tokenRepository: OAuthTokenRepository;
  todoistTaskMapRepository: TodoistTaskMapRepository;
  calendarEventMapRepository: CalendarEventMapRepository;
  reminderJobRepository: ReminderJobRepository;
  obsidianSyncStateRepository: ObsidianSyncStateRepository;
  todoistOAuthService: TodoistOAuthService;
  googleCalendarOAuthService: GoogleCalendarOAuthService;
  healthRegistry: SubsystemHealthRegistry;
  logger: Logger;
}

export function createServer({
  config,
  migrationResult,
  tokenRepository,
  todoistTaskMapRepository,
  calendarEventMapRepository,
  reminderJobRepository,
  obsidianSyncStateRepository,
  todoistOAuthService,
  googleCalendarOAuthService,
  healthRegistry,
  logger,
}: CreateServerDependencies) {
  const app = express();

  app.get('/health', async (_request, response) => {
    const [todoistToken, googleToken] = await Promise.all([
      tokenRepository.getByProvider('todoist'),
      tokenRepository.getByProvider('google-calendar'),
    ]);
    const [taskCache, eventCache, habitSummary, reminderSummary, obsidianState] = await Promise.all([
      todoistTaskMapRepository.getCacheSummary(),
      calendarEventMapRepository.getCacheSummary(),
      todoistTaskMapRepository.getHabitSummary(),
      reminderJobRepository.getSummary(),
      obsidianSyncStateRepository.getState(),
    ]);
    const runtime = healthRegistry.getSnapshot();
    const overall = buildOverallRuntimeSummary(runtime);
    const todoistConnected = Boolean(config.env.TODOIST_API_TOKEN) || todoistToken !== null;
    const providers = {
      todoist: buildProviderStatus(todoistConnected),
      googleCalendar: buildProviderStatus(googleToken !== null),
    };
    const taskCacheDiagnostics = enrichLatestUpdateSummary(taskCache, 60 * 30);
    const eventCacheDiagnostics = enrichLatestUpdateSummary(eventCache, 60 * 30);
    const reminderDiagnostics = buildReminderDiagnostics(reminderSummary);
    const habitDiagnostics = buildHabitDiagnostics(habitSummary);
    const obsidianDiagnostics = buildObsidianDiagnostics(obsidianState ?? null, {
      enabled: Boolean(config.obsidianVaultPath),
      pollIntervalSeconds: config.obsidianSyncPollIntervalSeconds,
      runtimeSubsystem: runtime.subsystems['obsidian-sync'],
    });

    response.json({
      status: runtime.status,
      overall,
      service: 'beanbot',
      environment: config.env.NODE_ENV,
      guildId: config.env.DISCORD_GUILD_ID,
      startedAtUtc: runtime.startedAtUtc,
      startupComplete: runtime.startupComplete,
      todoistConnected,
      googleCalendarConnected: googleToken !== null,
      providers,
      migration: buildMigrationRuntimeSummary(migrationResult),
      subsystems: runtime.subsystems,
      caches: {
        tasks: taskCacheDiagnostics,
        events: eventCacheDiagnostics,
      },
      habits: habitDiagnostics,
      reminders: reminderDiagnostics,
      obsidian: obsidianDiagnostics,
      timestamp: new Date().toISOString(),
    });
    logger.debug('Served health check', {
      status: runtime.status,
      todoistConnected,
      googleCalendarConnected: googleToken !== null,
    });
  });

  app.get('/auth/todoist/start', (_request, response) => {
    try {
      logger.info('Redirecting to Todoist OAuth start');
      response.redirect(todoistOAuthService.getStartUrl());
    } catch (error) {
      logger.error('Todoist OAuth start failed', error);
      response.status(500).type('html').send(renderAuthPage('Todoist setup error', getErrorMessage(error)));
    }
  });

  app.get('/auth/todoist/callback', async (request, response) => {
    const error = request.query.error;
    const code = request.query.code;
    const state = request.query.state;

    if (typeof error === 'string') {
      logger.warn('Todoist authorization returned an error', { error });
      response.status(400).type('html').send(renderAuthPage('Todoist authorization failed', error));
      return;
    }

    if (typeof code !== 'string' || typeof state !== 'string') {
      response
        .status(400)
        .type('html')
        .send(renderAuthPage('Todoist authorization failed', 'Missing code or state in callback.'));
      return;
    }

    if (!todoistOAuthService.validateCallbackState(state)) {
      response.status(400).type('html').send(renderAuthPage('Todoist authorization failed', 'Invalid OAuth state.'));
      return;
    }

    try {
      const token = await todoistOAuthService.exchangeCode(code);
      await tokenRepository.save(token);
      logger.info('Todoist connected successfully');
      response.type('html').send(renderAuthPage('Todoist connected', 'You can return to Discord and run /today.'));
    } catch (callbackError) {
      logger.error('Todoist OAuth callback failed', callbackError);
      response
        .status(500)
        .type('html')
        .send(renderAuthPage('Todoist authorization failed', getErrorMessage(callbackError)));
    }
  });

  app.get('/auth/google/start', (_request, response) => {
    try {
      logger.info('Redirecting to Google Calendar OAuth start');
      response.redirect(googleCalendarOAuthService.getStartUrl());
    } catch (error) {
      logger.error('Google Calendar OAuth start failed', error);
      response.status(500).type('html').send(renderAuthPage('Google setup error', getErrorMessage(error)));
    }
  });

  app.get('/auth/google/callback', async (request, response) => {
    const error = request.query.error;
    const code = request.query.code;
    const state = request.query.state;

    if (typeof error === 'string') {
      logger.warn('Google Calendar authorization returned an error', { error });
      response.status(400).type('html').send(renderAuthPage('Google authorization failed', error));
      return;
    }

    if (typeof code !== 'string' || typeof state !== 'string') {
      response
        .status(400)
        .type('html')
        .send(renderAuthPage('Google authorization failed', 'Missing code or state in callback.'));
      return;
    }

    if (!googleCalendarOAuthService.validateCallbackState(state)) {
      response.status(400).type('html').send(renderAuthPage('Google authorization failed', 'Invalid OAuth state.'));
      return;
    }

    try {
      const token = await googleCalendarOAuthService.exchangeCode(code);
      await tokenRepository.save(token);
      logger.info('Google Calendar connected successfully');
      response
        .type('html')
        .send(renderAuthPage('Google Calendar connected', 'You can return to Discord and run /today.'));
    } catch (callbackError) {
      logger.error('Google Calendar OAuth callback failed', callbackError);
      response
        .status(500)
        .type('html')
        .send(renderAuthPage('Google authorization failed', getErrorMessage(callbackError)));
    }
  });

  return app;
}

function renderAuthPage(title: string, message: string) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      body { font-family: Georgia, serif; padding: 40px; background: #f3efe6; color: #1d1d1b; }
      main { max-width: 640px; margin: 0 auto; background: #fffaf2; padding: 32px; border: 1px solid #d8c9ae; }
      h1 { margin-top: 0; }
      p { line-height: 1.5; }
    </style>
  </head>
  <body>
    <main>
      <h1>${title}</h1>
      <p>${message}</p>
    </main>
  </body>
</html>`;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error';
}
