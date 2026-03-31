import { createConfig } from '../config';
import { createDb } from '../db/client';
import { CalendarEventMapRepository } from '../db/calendar-event-map-repository';
import { HabitRepository } from '../db/habit-repository';
import { inspectMigrationHealth } from '../db/migrate';
import { ObsidianSyncStateRepository } from '../db/obsidian-sync-state-repository';
import { OAuthTokenRepository } from '../db/oauth-token-repository';
import { ReminderJobRepository } from '../db/reminder-job-repository';
import { TodoistTaskMapRepository } from '../db/todoist-task-map-repository';

async function main() {
  const config = createConfig();
  const db = createDb(config);
  const tokenRepository = new OAuthTokenRepository(db);
  const taskCacheRepository = new TodoistTaskMapRepository(db);
  const eventCacheRepository = new CalendarEventMapRepository(db);
  const habitRepository = new HabitRepository(db);
  const reminderRepository = new ReminderJobRepository(db);
  const obsidianSyncStateRepository = new ObsidianSyncStateRepository(db);

  const [migrationHealth, todoistToken, googleToken, taskCache, eventCache, habits, reminders, obsidianState] =
    await Promise.all([
      inspectMigrationHealth(config),
      tokenRepository.getByProvider('todoist'),
      tokenRepository.getByProvider('google-calendar'),
      taskCacheRepository.getCacheSummary(),
      eventCacheRepository.getCacheSummary(),
      habitRepository.getSummary(),
      reminderRepository.getSummary(),
      obsidianSyncStateRepository.getState(),
    ]);

  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    databasePath: config.databasePath,
    migrationHealth,
    providers: {
      todoistConnected: todoistToken !== null,
      googleCalendarConnected: googleToken !== null,
    },
    caches: {
      tasks: taskCache,
      events: eventCache,
    },
    habits,
    reminders,
    obsidian: {
      enabled: Boolean(config.obsidianVaultPath),
      lastFullSyncAtUtc: obsidianState?.lastFullSyncAtUtc ?? null,
      lastIncrementalSyncAtUtc: obsidianState?.lastIncrementalSyncAtUtc ?? null,
      lastVaultScanAtUtc: obsidianState?.lastVaultScanAtUtc ?? null,
      lastIncrementalCursorPresent: Boolean(obsidianState?.lastIncrementalCursor),
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
