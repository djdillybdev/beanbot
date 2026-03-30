import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import type { AppEnv } from './env';
import { loadEnv } from './env';
import type { LogLevel } from '../logging/logger';

export interface AppConfig {
  env: AppEnv;
  databasePath: string;
  obsidianVaultPath?: string;
  obsidianTasksPath: string;
  obsidianSyncPollIntervalSeconds: number;
  host: string;
  port: number;
  publicBaseUrl: string;
  timezone: string;
  inboxChannelId: string;
  todayChannelId: string;
  weekChannelId: string;
  monthChannelId: string;
  habitsChannelId: string;
  upcomingChannelId: string;
  remindersChannelId: string;
  logsChannelId?: string;
  logLevel: LogLevel;
  discordLogLevel: LogLevel;
}

export function createConfig(): AppConfig {
  const env = loadEnv();
  const databasePath = resolve(env.DATABASE_URL);

  mkdirSync(dirname(databasePath), { recursive: true });

  return {
    env,
    databasePath,
    obsidianVaultPath: env.OBSIDIAN_VAULT_PATH ? resolve(env.OBSIDIAN_VAULT_PATH) : undefined,
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
