import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const appConfig = sqliteTable('app_config', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  timezone: text('timezone').notNull(),
  defaultCalendarId: text('default_calendar_id').notNull(),
  digestChannelId: text('digest_channel_id').notNull(),
  remindersChannelId: text('reminders_channel_id').notNull(),
  inboxChannelId: text('inbox_channel_id').notNull(),
  planningChannelId: text('planning_channel_id'),
  createdAtUtc: text('created_at_utc')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAtUtc: text('updated_at_utc')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const actionLog = sqliteTable('action_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  actionType: text('action_type').notNull(),
  sourceCommand: text('source_command').notNull(),
  payloadJson: text('payload_json'),
  resultJson: text('result_json'),
  createdAtUtc: text('created_at_utc')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const reminderJobs = sqliteTable('reminder_jobs', {
  id: text('id').primaryKey(),
  sourceType: text('source_type').notNull(),
  sourceId: text('source_id').notNull(),
  remindAtUtc: text('remind_at_utc').notNull(),
  channelId: text('channel_id').notNull(),
  deliveredAtUtc: text('delivered_at_utc'),
  status: text('status').notNull(),
  createdAtUtc: text('created_at_utc')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const oauthTokens = sqliteTable('oauth_tokens', {
  provider: text('provider').primaryKey(),
  accessToken: text('access_token').notNull(),
  refreshToken: text('refresh_token'),
  tokenType: text('token_type'),
  scopeBlob: text('scope_blob'),
  expiryUtc: text('expiry_utc'),
  createdAtUtc: text('created_at_utc')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAtUtc: text('updated_at_utc')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});
