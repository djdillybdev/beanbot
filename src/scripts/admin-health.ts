import { createConfig } from '../config';
import { createDb } from '../db/client';
import { CalendarEventMapRepository } from '../db/calendar-event-map-repository';
import { inspectMigrationHealth } from '../db/migrate';
import { ObsidianSyncStateRepository } from '../db/obsidian-sync-state-repository';
import { OAuthTokenRepository } from '../db/oauth-token-repository';
import { ReminderJobRepository } from '../db/reminder-job-repository';
import { TodoistTaskMapRepository } from '../db/todoist-task-map-repository';
import {
  buildHabitDiagnostics,
  buildObsidianDiagnostics,
  buildProviderStatus,
  buildReminderDiagnostics,
  enrichLatestUpdateSummary,
  fetchRuntimeHealth,
} from '../runtime/diagnostics';
import {
  isJsonOutputRequested,
  printOutput,
  renderKeyValue,
  renderSection,
  renderTimestamp,
} from './admin-output';

async function main() {
  const config = createConfig();
  const db = createDb(config, { readonly: true });
  const tokenRepository = new OAuthTokenRepository(db);
  const taskCacheRepository = new TodoistTaskMapRepository(db);
  const eventCacheRepository = new CalendarEventMapRepository(db);
  const reminderRepository = new ReminderJobRepository(db);
  const obsidianSyncStateRepository = new ObsidianSyncStateRepository(db);
  const json = isJsonOutputRequested();
  const runtimeHealth = await fetchRuntimeHealth(config.publicBaseUrl).catch((error) => ({
    available: false,
    error: error instanceof Error ? error.message : String(error),
  }));

  const [migrationHealth, todoistToken, googleToken, taskCache, eventCache, habits, reminders, obsidianState] =
    await Promise.all([
      inspectMigrationHealth(config),
      tokenRepository.getByProvider('todoist'),
      tokenRepository.getByProvider('google-calendar'),
      taskCacheRepository.getCacheSummary(),
      eventCacheRepository.getCacheSummary(),
      taskCacheRepository.getHabitSummary(),
      reminderRepository.getSummary(),
      obsidianSyncStateRepository.getState(),
    ]);
  const todoistConnected = Boolean(config.env.TODOIST_API_TOKEN) || todoistToken !== null;
  const payload = {
    timestamp: new Date().toISOString(),
    databasePath: config.databasePath,
    migrationHealth,
    providers: {
      todoist: buildProviderStatus(todoistConnected),
      googleCalendar: buildProviderStatus(googleToken !== null),
    },
    caches: {
      tasks: enrichLatestUpdateSummary(taskCache, 60 * 30),
      events: enrichLatestUpdateSummary(eventCache, 60 * 30),
    },
    habits: buildHabitDiagnostics(habits),
    reminders: buildReminderDiagnostics(reminders),
    obsidian: buildObsidianDiagnostics(obsidianState ?? null, {
      enabled: Boolean(config.obsidianVaultPath),
      pollIntervalSeconds: config.obsidianSyncPollIntervalSeconds,
    }),
    runtimeHealth,
  };
  const runtimeUnavailable = 'available' in runtimeHealth && runtimeHealth.available === false;

  const lines = [
    ...renderSection('Overview', [
      renderKeyValue('Timestamp', payload.timestamp),
      renderKeyValue('Database', payload.databasePath),
      renderKeyValue('Migration status', `${migrationHealth.status} (${migrationHealth.issues.length} issues)`),
      renderKeyValue('Runtime health', runtimeUnavailable ? 'unavailable' : 'available'),
    ]),
    ...renderSection('Providers', [
      renderKeyValue('Todoist', payload.providers.todoist.status),
      renderKeyValue('Google Calendar', payload.providers.googleCalendar.status),
    ]),
    ...renderSection('Caches', [
      renderKeyValue(
        'Tasks',
        `${payload.caches.tasks.totalCount} total, ${payload.caches.tasks.activeCount} active, ${payload.caches.tasks.freshness}`,
      ),
      renderTimestamp('Tasks updated', payload.caches.tasks.latestUpdatedAtUtc),
      renderKeyValue(
        'Events',
        `${payload.caches.events.totalCount} total, ${payload.caches.events.activeCount} active, ${payload.caches.events.freshness}`,
      ),
      renderTimestamp('Events updated', payload.caches.events.latestUpdatedAtUtc),
    ]),
    ...renderSection('Habits', [
      renderKeyValue('Status', payload.habits.status),
      renderKeyValue('Active', payload.habits.activeCount),
      renderKeyValue('Needs review', payload.habits.unparsedActiveCount),
      renderTimestamp('Updated', payload.habits.latestUpdatedAtUtc),
    ]),
    ...renderSection('Reminders', [
      renderKeyValue('Status', payload.reminders.status),
      renderKeyValue('Pending', payload.reminders.pendingCount),
      renderKeyValue('Due now', payload.reminders.duePendingCount),
      renderKeyValue('Failed', payload.reminders.failedCount),
      renderTimestamp('Updated', payload.reminders.latestUpdatedAtUtc),
    ]),
    ...renderSection('Obsidian', [
      renderKeyValue('Status', payload.obsidian.status),
      renderKeyValue('Vault enabled', payload.obsidian.enabled),
      renderTimestamp('Incremental sync', payload.obsidian.lastIncrementalSyncAtUtc),
      renderTimestamp('Full sync', payload.obsidian.lastFullSyncAtUtc),
      renderTimestamp('Vault scan', payload.obsidian.lastVaultScanAtUtc),
    ]),
  ];

  if (migrationHealth.issues.length > 0) {
    lines.push(...renderSection('Migration Issues', migrationHealth.issues));
  }

  if (!runtimeUnavailable) {
    const runtime = runtimeHealth as {
      overall?: { status?: string; degradedSubsystems?: string[]; failedSubsystems?: string[] };
      subsystems?: Record<string, { state?: string; summary?: string }>;
    };
    lines.push(
      ...renderSection('Runtime', [
        renderKeyValue('Overall', runtime.overall?.status ?? 'unknown'),
        renderKeyValue('Degraded', runtime.overall?.degradedSubsystems?.join(', ') || 'none'),
        renderKeyValue('Failed', runtime.overall?.failedSubsystems?.join(', ') || 'none'),
      ]),
    );
  }

  printOutput(payload, lines, json);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
