import express from 'express';

import type { AppConfig } from '../config';
import { OAuthTokenRepository } from '../db/oauth-token-repository';
import { GoogleCalendarOAuthService } from '../integrations/google-calendar/oauth';
import { TodoistOAuthService } from '../integrations/todoist/oauth';

interface CreateServerDependencies {
  config: AppConfig;
  tokenRepository: OAuthTokenRepository;
  todoistOAuthService: TodoistOAuthService;
  googleCalendarOAuthService: GoogleCalendarOAuthService;
}

export function createServer({
  config,
  tokenRepository,
  todoistOAuthService,
  googleCalendarOAuthService,
}: CreateServerDependencies) {
  const app = express();

  app.get('/health', async (_request, response) => {
    const [todoistToken, googleToken] = await Promise.all([
      tokenRepository.getByProvider('todoist'),
      tokenRepository.getByProvider('google-calendar'),
    ]);

    response.json({
      status: 'ok',
      service: 'beanbot',
      environment: config.env.NODE_ENV,
      guildId: config.env.DISCORD_GUILD_ID,
      todoistConnected: todoistToken !== null,
      googleCalendarConnected: googleToken !== null,
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/auth/todoist/start', (_request, response) => {
    try {
      response.redirect(todoistOAuthService.getStartUrl());
    } catch (error) {
      response.status(500).type('html').send(renderAuthPage('Todoist setup error', getErrorMessage(error)));
    }
  });

  app.get('/auth/todoist/callback', async (request, response) => {
    const error = request.query.error;
    const code = request.query.code;
    const state = request.query.state;

    if (typeof error === 'string') {
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
      response.type('html').send(renderAuthPage('Todoist connected', 'You can return to Discord and run /today.'));
    } catch (callbackError) {
      response
        .status(500)
        .type('html')
        .send(renderAuthPage('Todoist authorization failed', getErrorMessage(callbackError)));
    }
  });

  app.get('/auth/google/start', (_request, response) => {
    try {
      response.redirect(googleCalendarOAuthService.getStartUrl());
    } catch (error) {
      response.status(500).type('html').send(renderAuthPage('Google setup error', getErrorMessage(error)));
    }
  });

  app.get('/auth/google/callback', async (request, response) => {
    const error = request.query.error;
    const code = request.query.code;
    const state = request.query.state;

    if (typeof error === 'string') {
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
      response
        .type('html')
        .send(renderAuthPage('Google Calendar connected', 'You can return to Discord and run /today.'));
    } catch (callbackError) {
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
