import { createConfig } from '../config';
import { createDb } from '../db/client';
import { ObsidianSyncEventRepository } from '../db/obsidian-sync-event-repository';
import { ObsidianSyncStateRepository } from '../db/obsidian-sync-state-repository';

async function main() {
  const config = createConfig();
  const db = createDb(config);
  const syncStateRepository = new ObsidianSyncStateRepository(db);
  const syncEventRepository = new ObsidianSyncEventRepository(db);
  const [state, recentEvents] = await Promise.all([
    syncStateRepository.getState(),
    syncEventRepository.listRecent(10),
  ]);

  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    enabled: Boolean(config.obsidianVaultPath),
    vaultPath: config.obsidianVaultPath ?? null,
    tasksPath: config.obsidianTasksPath,
    pollIntervalSeconds: config.obsidianSyncPollIntervalSeconds,
    state,
    recentEvents,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
