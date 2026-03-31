import { ObsidianLocalCreateService } from '../app/obsidian/obsidian-local-create-service';
import { ObsidianLocalScanService } from '../app/obsidian/obsidian-local-scan';
import { ObsidianPendingDeleteService } from '../app/obsidian/obsidian-pending-delete-service';
import { ObsidianPendingPushService } from '../app/obsidian/obsidian-pending-push-service';
import { ObsidianSyncService } from '../app/obsidian/obsidian-sync-service';
import { createConfig } from '../config';
import { createDb } from '../db/client';
import { runMigrations } from '../db/migrate';
import { ObsidianNoteIndexRepository } from '../db/obsidian-note-index-repository';
import { ObsidianSyncEventRepository } from '../db/obsidian-sync-event-repository';
import { ObsidianSyncStateRepository } from '../db/obsidian-sync-state-repository';
import { ObsidianTaskRepository } from '../db/obsidian-task-repository';
import { OAuthTokenRepository } from '../db/oauth-token-repository';
import { ObsidianVaultAdapter } from '../integrations/obsidian/vault-adapter';
import { TodoistClient } from '../integrations/todoist/client';
import { createLogger } from '../logging/logger';

async function main() {
  const config = createConfig();
  const logger = createLogger({
    consoleLevel: config.logLevel,
    discordLevel: config.discordLogLevel,
  }).child({ subsystem: 'obsidian-sync' });

  if (!config.obsidianVaultPath) {
    throw new Error('OBSIDIAN_VAULT_PATH must be set before running sync:obsidian.');
  }

  runMigrations(config);
  const db = createDb(config);
  const tokenRepository = new OAuthTokenRepository(db);
  const todoistClient = new TodoistClient(config, tokenRepository);
  const taskRepository = new ObsidianTaskRepository(db);
  const noteIndexRepository = new ObsidianNoteIndexRepository(db);
  const syncStateRepository = new ObsidianSyncStateRepository(db);
  const syncEventRepository = new ObsidianSyncEventRepository(db);
  const vaultAdapter = new ObsidianVaultAdapter(
    config.obsidianVaultPath,
    config.obsidianTasksPath,
    config.timezone,
    logger.child({ subsystem: 'vault-export' }),
  );
  const localCreateService = new ObsidianLocalCreateService(
    config,
    todoistClient,
    taskRepository,
    noteIndexRepository,
    syncEventRepository,
    logger.child({ subsystem: 'vault-create' }),
  );
  const localScanService = new ObsidianLocalScanService(
    config,
    noteIndexRepository,
    taskRepository,
    syncEventRepository,
    syncStateRepository,
    localCreateService,
    logger.child({ subsystem: 'vault-scan' }),
  );
  const pendingDeleteService = new ObsidianPendingDeleteService(
    todoistClient,
    taskRepository,
    noteIndexRepository,
    syncEventRepository,
    logger.child({ subsystem: 'pending-delete' }),
  );
  const pendingPushService = new ObsidianPendingPushService(
    todoistClient,
    taskRepository,
    syncEventRepository,
    logger.child({ subsystem: 'pending-push' }),
  );
  const syncService = new ObsidianSyncService(
    config,
    todoistClient,
    taskRepository,
    noteIndexRepository,
    syncStateRepository,
    syncEventRepository,
    localScanService,
    pendingDeleteService,
    pendingPushService,
    vaultAdapter,
    logger,
  );

  let isRunning = false;

  const runPass = async () => {
    if (isRunning) {
      logger.warn('Skipping Obsidian sync pass because the previous pass is still running.');
      return;
    }

    isRunning = true;
    try {
      await syncService.runOnce();
    } finally {
      isRunning = false;
    }
  };

  await runPass();
  setInterval(() => {
    void runPass();
  }, config.obsidianSyncPollIntervalSeconds * 1000);

  logger.info('Obsidian sync runner started', {
    pollIntervalSeconds: config.obsidianSyncPollIntervalSeconds,
    vaultPath: config.obsidianVaultPath,
    tasksPath: config.obsidianTasksPath,
  });
}

main().catch((error) => {
  createLogger({ consoleLevel: 'debug', discordLevel: 'error' }).error(
    'Obsidian sync runner failed',
    error,
    { subsystem: 'obsidian-sync' },
  );
  process.exit(1);
});
