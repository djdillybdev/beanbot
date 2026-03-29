import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text, uniqueIndex, index } from 'drizzle-orm/sqlite-core';

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

export const reminderJobs = sqliteTable(
  'reminder_jobs',
  {
    id: text('id').primaryKey(),
    sourceType: text('source_type').notNull(),
    sourceId: text('source_id').notNull(),
    reminderKind: text('reminder_kind').notNull(),
    dedupeKey: text('dedupe_key').notNull(),
    remindAtUtc: text('remind_at_utc').notNull(),
    channelId: text('channel_id').notNull(),
    payloadJson: text('payload_json').notNull(),
    deliveredAtUtc: text('delivered_at_utc'),
    status: text('status').notNull(),
    createdAtUtc: text('created_at_utc')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAtUtc: text('updated_at_utc')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    dedupeKeyIdx: uniqueIndex('reminder_jobs_dedupe_key_idx').on(table.dedupeKey),
    dueStatusIdx: index('reminder_jobs_status_remind_at_idx').on(table.status, table.remindAtUtc),
  }),
);

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

export const todoistTaskMap = sqliteTable('todoist_task_map', {
  todoistTaskId: text('todoist_task_id').primaryKey(),
  normalizedTitle: text('normalized_title').notNull(),
  lastSeenContent: text('last_seen_content').notNull(),
  lastSeenPriority: integer('last_seen_priority').notNull().default(1),
  lastSeenProjectId: text('last_seen_project_id'),
  lastSeenProjectName: text('last_seen_project_name'),
  lastSeenDueLabel: text('last_seen_due_label'),
  lastSeenDueDate: text('last_seen_due_date'),
  lastSeenDueDatetimeUtc: text('last_seen_due_datetime_utc'),
  lastSeenDueString: text('last_seen_due_string'),
  lastSeenLabelsCsv: text('last_seen_labels_csv'),
  lastSeenUrl: text('last_seen_url').notNull(),
  taskStatus: text('task_status').notNull().default('active'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAtUtc: text('created_at_utc')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAtUtc: text('updated_at_utc')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const calendarEventMap = sqliteTable('calendar_event_map', {
  googleEventId: text('google_event_id').primaryKey(),
  calendarId: text('calendar_id').notNull(),
  normalizedTitle: text('normalized_title').notNull(),
  lastSeenSummary: text('last_seen_summary').notNull(),
  lastSeenStartUtc: text('last_seen_start_utc').notNull(),
  lastSeenEndUtc: text('last_seen_end_utc').notNull(),
  lastSeenLocation: text('last_seen_location'),
  lastSeenDescription: text('last_seen_description'),
  lastSeenStartLabel: text('last_seen_start_label').notNull(),
  lastSeenUrl: text('last_seen_url'),
  eventStatus: text('event_status').notNull().default('active'),
  isRecurring: integer('is_recurring', { mode: 'boolean' }).notNull().default(false),
  createdAtUtc: text('created_at_utc')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAtUtc: text('updated_at_utc')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});
