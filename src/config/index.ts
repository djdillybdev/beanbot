import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import type { AppEnv } from './env';
import { loadEnv } from './env';

export interface AppConfig {
  env: AppEnv;
  databasePath: string;
  host: string;
  port: number;
  publicBaseUrl: string;
  timezone: string;
  todayChannelId: string;
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
    todayChannelId: env.TODAY_CHANNEL_ID,
  };
}
