import { z } from 'zod';

function requiredString(name: string) {
  return z.string().min(1, `${name} is required`);
}

const envSchema = z.object({
  DISCORD_TOKEN: requiredString('DISCORD_TOKEN'),
  DISCORD_APPLICATION_ID: requiredString('DISCORD_APPLICATION_ID'),
  DISCORD_GUILD_ID: requiredString('DISCORD_GUILD_ID'),
  DATABASE_URL: requiredString('DATABASE_URL'),
  BOT_TIMEZONE: requiredString('BOT_TIMEZONE').default('UTC'),
  TODAY_CHANNEL_ID: requiredString('TODAY_CHANNEL_ID'),
  REMINDERS_CHANNEL_ID: requiredString('REMINDERS_CHANNEL_ID'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  PUBLIC_BASE_URL: z.string().url().optional(),
  OAUTH_STATE_SECRET: z.string().min(32, 'OAUTH_STATE_SECRET must be at least 32 characters').optional(),
  TODOIST_CLIENT_ID: z.string().min(1).optional(),
  TODOIST_CLIENT_SECRET: z.string().min(1).optional(),
  TODOIST_REDIRECT_URI: z.string().url().optional(),
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  GOOGLE_REDIRECT_URI: z.string().url().optional(),
  GOOGLE_DEFAULT_CALENDAR_ID: z.string().min(1).default('primary'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type AppEnv = z.infer<typeof envSchema>;

export function loadEnv(): AppEnv {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `- ${issue.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  return parsed.data;
}
