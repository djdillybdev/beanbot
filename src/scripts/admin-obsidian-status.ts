import { createConfig } from '../config';
import { createDb } from '../db/client';
import { ObsidianSyncEventRepository } from '../db/obsidian-sync-event-repository';
import { ObsidianSyncStateRepository } from '../db/obsidian-sync-state-repository';
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
  const json = isJsonOutputRequested();
  const [state, recentEvents] = await Promise.all([
    syncStateRepository.getState(),
    syncEventRepository.listRecent(10),
  ]);
  const runtimeHealth = await fetchRuntimeHealth(config.publicBaseUrl).catch(() => null);
  const runtimeSubsystem = runtimeHealth && typeof runtimeHealth === 'object'
    ? (runtimeHealth.subsystems as Record<string, SubsystemSnapshot> | undefined)?.['obsidian-sync']
    : undefined;
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
