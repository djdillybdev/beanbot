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
  lastSeenSectionId: text('last_seen_section_id'),
  lastSeenParentId: text('last_seen_parent_id'),
  lastSeenOrderIndex: integer('last_seen_order_index'),
  lastSeenCreatedAtUtc: text('last_seen_created_at_utc'),
  lastSeenUpdatedAtUtc: text('last_seen_updated_at_utc'),
  lastSeenDueLabel: text('last_seen_due_label'),
  lastSeenDueDate: text('last_seen_due_date'),
  lastSeenDueDatetimeUtc: text('last_seen_due_datetime_utc'),
  lastSeenDueString: text('last_seen_due_string'),
  lastSeenRecurring: integer('last_seen_recurring', { mode: 'boolean' }).notNull().default(false),
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

export const taskCompletion = sqliteTable(
  'task_completion',
  {
    eventKey: text('event_key').primaryKey(),
    todoistTaskId: text('todoist_task_id').notNull(),
    normalizedTitle: text('normalized_title').notNull(),
    title: text('title').notNull(),
    completedAtUtc: text('completed_at_utc').notNull(),
    completedLocalDate: text('completed_local_date').notNull(),
    source: text('source').notNull(),
    priority: integer('priority').notNull().default(1),
    projectId: text('project_id'),
    projectName: text('project_name'),
    recurring: integer('recurring', { mode: 'boolean' }).notNull().default(false),
    dueDate: text('due_date'),
    dueDatetimeUtc: text('due_datetime_utc'),
    dueString: text('due_string'),
    labelsCsv: text('labels_csv'),
    url: text('url').notNull(),
    provisional: integer('provisional', { mode: 'boolean' }).notNull().default(false),
    createdAtUtc: text('created_at_utc')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    taskIdx: index('task_completion_task_idx').on(table.todoistTaskId, table.completedAtUtc),
    localDateIdx: index('task_completion_local_date_idx').on(table.completedLocalDate, table.completedAtUtc),
    provisionalIdx: index('task_completion_task_local_date_idx').on(table.todoistTaskId, table.completedLocalDate, table.provisional),
  }),
);

export const habitCompletionHistory = sqliteTable(
  'habit_completion_history',
  {
    dedupeKey: text('dedupe_key').primaryKey(),
    todoistTaskId: text('todoist_task_id').notNull(),
    normalizedTitle: text('normalized_title').notNull(),
    title: text('title').notNull(),
    completedAtUtc: text('completed_at_utc').notNull(),
    completedLocalDate: text('completed_local_date').notNull(),
    source: text('source').notNull(),
    priority: integer('priority').notNull().default(1),
    projectId: text('project_id'),
    projectName: text('project_name'),
    url: text('url').notNull(),
    createdAtUtc: text('created_at_utc')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    taskIdx: index('habit_completion_history_task_idx').on(table.todoistTaskId, table.completedAtUtc),
    localDateIdx: index('habit_completion_history_local_date_idx').on(table.completedLocalDate, table.completedAtUtc),
  }),
);

export const habit = sqliteTable(
  'habit',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    todoistTaskId: text('todoist_task_id'),
    title: text('title').notNull(),
    normalizedTitle: text('normalized_title').notNull(),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    activeStatus: text('active_status').notNull().default('inactive'),
    projectId: text('project_id'),
    projectName: text('project_name'),
    todoistUrl: text('todoist_url'),
    rawRecurrenceText: text('raw_recurrence_text'),
    currentDueDate: text('current_due_date'),
    currentDueDatetimeUtc: text('current_due_datetime_utc'),
    currentDueString: text('current_due_string'),
    scheduleKind: text('schedule_kind').notNull().default('unparsed'),
    scheduleJson: text('schedule_json').notNull().default('{}'),
    currentStreak: integer('current_streak').notNull().default(0),
    longestStreak: integer('longest_streak').notNull().default(0),
    lastCompletedLocalDate: text('last_completed_local_date'),
    completionCount: integer('completion_count').notNull().default(0),
    streakUpdatedAtUtc: text('streak_updated_at_utc'),
    createdAtUtc: text('created_at_utc')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAtUtc: text('updated_at_utc')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    todoistTaskIdx: uniqueIndex('habit_todoist_task_id_idx').on(table.todoistTaskId),
    activeIdx: index('habit_active_idx').on(table.isActive, table.updatedAtUtc),
    normalizedIdx: index('habit_normalized_title_idx').on(table.normalizedTitle),
  }),
);

export const habitCompletion = sqliteTable(
  'habit_completion',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    habitId: integer('habit_id').notNull(),
    todoistTaskId: text('todoist_task_id'),
    completedAtUtc: text('completed_at_utc').notNull(),
    completedLocalDate: text('completed_local_date').notNull(),
    source: text('source').notNull(),
    createdAtUtc: text('created_at_utc')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    habitDateIdx: uniqueIndex('habit_completion_habit_date_idx').on(table.habitId, table.completedLocalDate),
    taskIdx: index('habit_completion_task_idx').on(table.todoistTaskId, table.completedAtUtc),
    localDateIdx: index('habit_completion_local_date_idx').on(table.completedLocalDate, table.completedAtUtc),
  }),
);

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

export const todayStatusMessage = sqliteTable('today_status_message', {
  dateKey: text('date_key').primaryKey(),
  channelId: text('channel_id').notNull(),
  messageId: text('message_id').notNull(),
  snapshotJson: text('snapshot_json').notNull(),
  isPinned: integer('is_pinned', { mode: 'boolean' }).notNull().default(false),
  createdAtUtc: text('created_at_utc')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAtUtc: text('updated_at_utc')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const periodStatusMessage = sqliteTable('period_status_message', {
  statusType: text('status_type').notNull(),
  periodKey: text('period_key').notNull(),
  channelId: text('channel_id').notNull(),
  messageId: text('message_id').notNull(),
  snapshotJson: text('snapshot_json').notNull(),
  isPinned: integer('is_pinned', { mode: 'boolean' }).notNull().default(false),
  createdAtUtc: text('created_at_utc')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAtUtc: text('updated_at_utc')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  primary: uniqueIndex('period_status_message_type_period_idx').on(table.statusType, table.periodKey),
  channelTypeIdx: index('period_status_message_channel_type_idx').on(table.channelId, table.statusType),
}));

export const obsidianTask = sqliteTable(
  'obsidian_task',
  {
    todoistTaskId: text('todoist_task_id').primaryKey(),
    content: text('content').notNull(),
    completed: integer('completed', { mode: 'boolean' }).notNull().default(false),
    priorityApi: integer('priority_api').notNull().default(1),
    project: text('project'),
    effort: text('effort'),
    todoistProjectId: text('todoist_project_id'),
    todoistProjectName: text('todoist_project_name'),
    sectionId: text('section_id'),
    sectionName: text('section_name'),
    dueDate: text('due_date'),
    dueDatetimeUtc: text('due_datetime_utc'),
    recurring: integer('recurring', { mode: 'boolean' }).notNull().default(false),
    parentId: text('parent_id'),
    orderIndex: integer('order_index'),
    todoistUrl: text('todoist_url').notNull(),
    createdAtUtc: text('created_at_utc'),
    sourceUpdatedAtUtc: text('source_updated_at_utc'),
    dbUpdatedAtUtc: text('db_updated_at_utc')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    lastSyncedAtUtc: text('last_synced_at_utc')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    syncStatus: text('sync_status').notNull().default('synced'),
    sourceOfLastChange: text('source_of_last_change').notNull().default('todoist'),
    contentHash: text('content_hash'),
    noteBody: text('note_body'),
    taskStatus: text('task_status').notNull().default('active'),
  },
  (table) => ({
    statusUpdatedIdx: index('obsidian_task_status_updated_idx').on(table.taskStatus, table.dbUpdatedAtUtc),
    syncStatusIdx: index('obsidian_task_sync_status_idx').on(table.syncStatus),
  }),
);

export const obsidianTaskLabel = sqliteTable(
  'obsidian_task_label',
  {
    todoistTaskId: text('todoist_task_id').notNull(),
    labelName: text('label_name').notNull(),
    createdAtUtc: text('created_at_utc')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    primary: uniqueIndex('obsidian_task_label_task_label_idx').on(table.todoistTaskId, table.labelName),
    labelIdx: index('obsidian_task_label_name_idx').on(table.labelName),
  }),
);

export const obsidianNoteIndex = sqliteTable('obsidian_note_index', {
  todoistTaskId: text('todoist_task_id').primaryKey(),
  filePath: text('file_path').notNull(),
  contentHash: text('content_hash').notNull(),
  metadataHash: text('metadata_hash').notNull(),
  lastFileMtimeUtc: text('last_file_mtime_utc'),
  lastImportedAtUtc: text('last_imported_at_utc'),
  lastExportedAtUtc: text('last_exported_at_utc')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const obsidianSyncState = sqliteTable('obsidian_sync_state', {
  syncKey: text('sync_key').primaryKey(),
  lastFullSyncAtUtc: text('last_full_sync_at_utc'),
  lastIncrementalSyncAtUtc: text('last_incremental_sync_at_utc'),
  lastIncrementalCursor: text('last_incremental_cursor'),
  lastVaultScanAtUtc: text('last_vault_scan_at_utc'),
  updatedAtUtc: text('updated_at_utc')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const obsidianSyncEvent = sqliteTable(
  'obsidian_sync_event',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    eventType: text('event_type').notNull(),
    source: text('source').notNull(),
    todoistTaskId: text('todoist_task_id'),
    payloadSummary: text('payload_summary'),
    result: text('result'),
    createdAtUtc: text('created_at_utc')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    sourceCreatedIdx: index('obsidian_sync_event_source_created_idx').on(table.source, table.createdAtUtc),
    taskCreatedIdx: index('obsidian_sync_event_task_created_idx').on(table.todoistTaskId, table.createdAtUtc),
  }),
);
