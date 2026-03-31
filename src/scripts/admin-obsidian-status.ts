import { createConfig } from '../config';
import { createDb } from '../db/client';
import { ObsidianNoteIndexRepository } from '../db/obsidian-note-index-repository';
import { ObsidianSyncEventRepository } from '../db/obsidian-sync-event-repository';
import { ObsidianSyncStateRepository } from '../db/obsidian-sync-state-repository';
import { ObsidianTaskRepository } from '../db/obsidian-task-repository';
import { summarizeConflict } from '../app/admin/operator-service';
import { buildObsidianDiagnostics, fetchRuntimeHealth } from '../runtime/diagnostics';
import type { SubsystemSnapshot } from '../runtime/subsystem-health';
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
  const syncStateRepository = new ObsidianSyncStateRepository(db);
  const syncEventRepository = new ObsidianSyncEventRepository(db);
  const taskRepository = new ObsidianTaskRepository(db);
  const noteIndexRepository = new ObsidianNoteIndexRepository(db);
  const json = isJsonOutputRequested();
  const [state, recentEvents, unhealthyTasks] = await Promise.all([
    syncStateRepository.getState(),
    syncEventRepository.listRecent(10),
    taskRepository.listUnhealthy(50),
  ]);
  const runtimeHealth = await fetchRuntimeHealth(config.publicBaseUrl).catch(() => null);
  const runtimeSubsystem = runtimeHealth && typeof runtimeHealth === 'object'
    ? (runtimeHealth.subsystems as Record<string, SubsystemSnapshot> | undefined)?.['obsidian-sync']
    : undefined;
  const noteIndexes = await Promise.all(
    unhealthyTasks.map((task) => noteIndexRepository.findByTaskId(task.todoistTaskId)),
  );
  const latestEvents = await syncEventRepository.listRecentByTaskIds(
    unhealthyTasks.map((task) => task.todoistTaskId),
    200,
  );
  const latestEventByTaskId = new Map<string, (typeof latestEvents)[number]>();
  for (const event of latestEvents) {
    if (!event.todoistTaskId || latestEventByTaskId.has(event.todoistTaskId)) {
      continue;
    }

    latestEventByTaskId.set(event.todoistTaskId, event);
  }
  const noteIndexByTaskId = new Map(
    noteIndexes
      .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined && entry !== null)
      .map((entry) => [entry.todoistTaskId, entry]),
  );
  const conflicts = unhealthyTasks.map((task) =>
    summarizeConflict(
      task,
      latestEventByTaskId.get(task.todoistTaskId),
      noteIndexByTaskId.get(task.todoistTaskId)?.filePath,
    ));
  const diagnostics = buildObsidianDiagnostics(state ?? null, {
    enabled: Boolean(config.obsidianVaultPath),
    pollIntervalSeconds: config.obsidianSyncPollIntervalSeconds,
    runtimeSubsystem,
  });
  const payload = {
    timestamp: new Date().toISOString(),
    enabled: Boolean(config.obsidianVaultPath),
    vaultPath: config.obsidianVaultPath ?? null,
    tasksPath: config.obsidianTasksPath,
    pollIntervalSeconds: config.obsidianSyncPollIntervalSeconds,
    runtimeSubsystem: runtimeSubsystem ?? null,
    diagnostics,
    state,
    recentEvents,
    conflicts,
  };
  const lines = [
    ...renderSection('Overview', [
      renderKeyValue('Enabled', payload.enabled),
      renderKeyValue('Status', payload.diagnostics.status),
      renderKeyValue('Poll interval', `${payload.pollIntervalSeconds}s`),
      renderKeyValue('Vault path', payload.vaultPath ?? 'not configured'),
      renderKeyValue('Tasks path', payload.tasksPath),
    ]),
    ...renderSection('Runtime', [
      renderKeyValue('Runner state', payload.runtimeSubsystem?.state ?? 'unavailable'),
      renderKeyValue('Runner summary', payload.runtimeSubsystem?.summary ?? 'n/a'),
    ]),
    ...renderSection('Sync State', [
      renderTimestamp('Incremental sync', payload.diagnostics.lastIncrementalSyncAtUtc),
      renderTimestamp('Full sync', payload.diagnostics.lastFullSyncAtUtc),
      renderTimestamp('Vault scan', payload.diagnostics.lastVaultScanAtUtc),
      renderKeyValue('Incremental cursor present', payload.diagnostics.lastIncrementalCursorPresent),
    ]),
    ...renderSection(
      'Conflicts',
      payload.conflicts.length === 0
        ? ['No tracked conflicts.']
        : payload.conflicts.map((conflict) =>
            `${conflict.taskId} ${conflict.kind} (${conflict.syncStatus})${conflict.recommendedAction ? ` -> ${conflict.recommendedAction}` : ''}`),
    ),
    ...renderSection(
      'Recent Events',
      payload.recentEvents.length === 0
        ? ['No sync events recorded.']
        : payload.recentEvents.map((event) =>
            `${event.createdAtUtc} ${event.eventType} [${event.result ?? 'n/a'}]${event.payloadSummary ? ` ${event.payloadSummary}` : ''}`),
    ),
  ];

  printOutput(payload, lines, json);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
