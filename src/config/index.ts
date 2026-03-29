import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import type { AppEnv } from './env';
import { loadEnv } from './env';
import type { LogLevel } from '../logging/logger';

export interface AppConfig {
  env: AppEnv;
  databasePath: string;
  host: string;
  port: number;
  publicBaseUrl: string;
  timezone: string;
  inboxChannelId: string;
  todayChannelId: string;
  weekChannelId: string;
  monthChannelId: string;
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
    host: env.HOST,
    port: env.PORT,
    publicBaseUrl: env.PUBLIC_BASE_URL ?? `http://${env.HOST}:${env.PORT}`,
    timezone: env.BOT_TIMEZONE,
    inboxChannelId: env.INBOX_CHANNEL_ID,
    todayChannelId: env.TODAY_CHANNEL_ID,
    weekChannelId: env.WEEK_CHANNEL_ID,
    monthChannelId: env.MONTH_CHANNEL_ID,
    remindersChannelId: env.REMINDERS_CHANNEL_ID,
    logsChannelId: env.LOGS_CHANNEL_ID,
    logLevel: env.LOG_LEVEL,
    discordLogLevel: env.DISCORD_LOG_LEVEL,
  };
}
