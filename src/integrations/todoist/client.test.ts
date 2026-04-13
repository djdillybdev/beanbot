import { afterEach, describe, expect, mock, test } from 'bun:test';

import type { AppConfig } from '../../config';
import type { AppEnv } from '../../config/env';
import type { OAuthTokenRepository } from '../../db/oauth-token-repository';
import type { OAuthProvider, StoredOAuthToken } from '../../domain/oauth';
import { TodoistClient } from './client';

const originalFetch = globalThis.fetch;

describe('TodoistClient auth', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('personal API token configures and connects Todoist without a saved OAuth token', async () => {
    const client = new TodoistClient(
      buildConfig({ TODOIST_API_TOKEN: 'personal-token' }),
      new FakeTokenRepository(null).asRepository(),
    );

    expect(client.isConfigured()).toBe(true);
    expect(await client.isConnected()).toBe(true);
  });

  test('saved OAuth token still connects Todoist when no personal API token is configured', async () => {
    const client = new TodoistClient(
      buildConfig({
        OAUTH_STATE_SECRET: 'x'.repeat(32),
        TODOIST_CLIENT_ID: 'client-id',
        TODOIST_CLIENT_SECRET: 'client-secret',
        TODOIST_REDIRECT_URI: 'http://127.0.0.1:3000/auth/todoist/callback',
      }),
      new FakeTokenRepository(buildToken('oauth-token')).asRepository(),
    );

    expect(client.isConfigured()).toBe(true);
    expect(await client.isConnected()).toBe(true);
  });

  test('personal API token takes precedence over a saved OAuth token for requests', async () => {
    const authHeaders: (string | null)[] = [];
    globalThis.fetch = mock(async (_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      authHeaders.push(getHeader(init?.headers, 'Authorization'));
      return Response.json({ results: [], next_cursor: null });
    }) as unknown as typeof fetch;
    const repository = new FakeTokenRepository(buildToken('oauth-token'));
    const client = new TodoistClient(
      buildConfig({ TODOIST_API_TOKEN: 'personal-token' }),
      repository.asRepository(),
    );

    await client.getProjects();

    expect(authHeaders[0]).toBe('Bearer personal-token');
    expect(repository.getByProviderCount).toBe(0);
  });

  test('throws when neither personal API token nor saved OAuth token exists', async () => {
    const client = new TodoistClient(
      buildConfig(),
      new FakeTokenRepository(null).asRepository(),
    );

    expect(client.isConfigured()).toBe(false);
    await expect(client.getProjects()).rejects.toThrow('Todoist is not connected.');
  });
});

class FakeTokenRepository {
  getByProviderCount = 0;

  constructor(private readonly token: StoredOAuthToken | null) {}

  async getByProvider(provider: OAuthProvider) {
    this.getByProviderCount += 1;
    return provider === 'todoist' ? this.token : null;
  }

  asRepository(): Pick<OAuthTokenRepository, 'getByProvider'> {
    return this;
  }
}

function buildConfig(envOverrides: Partial<AppEnv> = {}): AppConfig {
  const env: AppEnv = {
    DISCORD_TOKEN: 'discord-token',
    DISCORD_APPLICATION_ID: 'discord-app',
    DISCORD_GUILD_ID: 'discord-guild',
    DATABASE_URL: ':memory:',
    BOT_TIMEZONE: 'Europe/Madrid',
    INBOX_CHANNEL_ID: 'inbox',
    TODAY_CHANNEL_ID: 'today',
    WEEK_CHANNEL_ID: 'week',
    MONTH_CHANNEL_ID: 'month',
    HABITS_CHANNEL_ID: 'habits',
    UPCOMING_CHANNEL_ID: 'upcoming',
    REMINDERS_CHANNEL_ID: 'reminders',
    LOG_LEVEL: 'info',
    DISCORD_LOG_LEVEL: 'warn',
    HOST: '127.0.0.1',
    PORT: 3000,
    OBSIDIAN_TASKS_PATH: 'Tasks/todoist',
    OBSIDIAN_SYNC_POLL_INTERVAL_SECONDS: 300,
    GOOGLE_DEFAULT_CALENDAR_ID: 'primary',
    NODE_ENV: 'test',
    ...envOverrides,
  };

  return {
    env,
    databasePath: env.DATABASE_URL,
    obsidianVaultPath: env.OBSIDIAN_VAULT_PATH,
    obsidianTasksPath: env.OBSIDIAN_TASKS_PATH,
    obsidianSyncPollIntervalSeconds: env.OBSIDIAN_SYNC_POLL_INTERVAL_SECONDS,
    host: env.HOST,
    port: env.PORT,
    publicBaseUrl: env.PUBLIC_BASE_URL ?? `http://${env.HOST}:${env.PORT}`,
    timezone: env.BOT_TIMEZONE,
    inboxChannelId: env.INBOX_CHANNEL_ID,
    todayChannelId: env.TODAY_CHANNEL_ID,
    weekChannelId: env.WEEK_CHANNEL_ID,
    monthChannelId: env.MONTH_CHANNEL_ID,
    habitsChannelId: env.HABITS_CHANNEL_ID,
    upcomingChannelId: env.UPCOMING_CHANNEL_ID,
    remindersChannelId: env.REMINDERS_CHANNEL_ID,
    logsChannelId: env.LOGS_CHANNEL_ID,
    logLevel: env.LOG_LEVEL,
    discordLogLevel: env.DISCORD_LOG_LEVEL,
  };
}

function buildToken(accessToken: string): StoredOAuthToken {
  return {
    provider: 'todoist',
    accessToken,
    refreshToken: null,
    tokenType: 'Bearer',
    scopeBlob: 'data:read_write',
    expiryUtc: null,
  };
}

function getHeader(headers: NonNullable<Parameters<typeof fetch>[1]>['headers'] | undefined, name: string): string | null {
  if (!headers) {
    return null;
  }

  if (headers instanceof Headers) {
    return headers.get(name);
  }

  if (Array.isArray(headers)) {
    for (const [key, value] of headers) {
      if (key?.toLowerCase() === name.toLowerCase()) {
        return value ?? null;
      }
    }

    return null;
  }

  return normalizeHeaderValue(headers[name] ?? headers[name.toLowerCase()]);
}

function normalizeHeaderValue(value: string | readonly string[] | undefined): string | null {
  if (value === undefined) {
    return null;
  }

  if (typeof value === 'string') {
    return value;
  }

  return value.join(', ');
}
