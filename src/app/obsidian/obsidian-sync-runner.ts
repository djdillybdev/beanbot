import type { AppConfig } from '../../config';
import { ObsidianNoteIndexRepository } from '../../db/obsidian-note-index-repository';
import { ObsidianSyncEventRepository } from '../../db/obsidian-sync-event-repository';
import { ObsidianSyncStateRepository } from '../../db/obsidian-sync-state-repository';
import { ObsidianTaskRepository } from '../../db/obsidian-task-repository';
import type { Database } from '../../db/types';
import { ObsidianVaultAdapter } from '../../integrations/obsidian/vault-adapter';
import { TodoistClient } from '../../integrations/todoist/client';
import type { Logger } from '../../logging/logger';
import { ObsidianLocalCreateService } from './obsidian-local-create-service';
import { ObsidianLocalScanService } from './obsidian-local-scan';
import { ObsidianPendingDeleteService } from './obsidian-pending-delete-service';
import { ObsidianPendingPushService } from './obsidian-pending-push-service';
import { ObsidianSyncService } from './obsidian-sync-service';

export interface ObsidianSyncRuntime {
  stop(): void;
}

export async function startObsidianSyncRuntime(
  config: AppConfig,
  db: Database,
  todoistClient: TodoistClient,
  logger: Logger,
): Promise<ObsidianSyncRuntime> {
  const runtimeLogger = logger.child({ subsystem: 'obsidian-sync' });

  if (!config.obsidianVaultPath) {
    runtimeLogger.info('Obsidian sync disabled because OBSIDIAN_VAULT_PATH is not configured.');
    return {
      stop() {},
    };
  }

  const taskRepository = new ObsidianTaskRepository(db);
  const noteIndexRepository = new ObsidianNoteIndexRepository(db);
  const syncStateRepository = new ObsidianSyncStateRepository(db);
  const syncEventRepository = new ObsidianSyncEventRepository(db);
  const vaultAdapter = new ObsidianVaultAdapter(
    config.obsidianVaultPath,
    config.obsidianTasksPath,
    config.timezone,
    runtimeLogger.child({ subsystem: 'vault-export' }),
  );
  const localCreateService = new ObsidianLocalCreateService(
    config,
    todoistClient,
    taskRepository,
    noteIndexRepository,
    syncEventRepository,
    runtimeLogger.child({ subsystem: 'vault-create' }),
  );
  const localScanService = new ObsidianLocalScanService(
    config,
    noteIndexRepository,
    taskRepository,
    syncEventRepository,
    syncStateRepository,
    localCreateService,
    runtimeLogger.child({ subsystem: 'vault-scan' }),
  );
  const pendingDeleteService = new ObsidianPendingDeleteService(
    todoistClient,
    taskRepository,
    noteIndexRepository,
    syncEventRepository,
    runtimeLogger.child({ subsystem: 'pending-delete' }),
  );
  const pendingPushService = new ObsidianPendingPushService(
    todoistClient,
    taskRepository,
    syncEventRepository,
    runtimeLogger.child({ subsystem: 'pending-push' }),
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
    runtimeLogger,
  );

  let isRunning = false;

  const runPass = async () => {
    if (isRunning) {
      runtimeLogger.warn('Skipping Obsidian sync pass because the previous pass is still running.');
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

  const intervalId = setInterval(() => {
    void runPass();
  }, config.obsidianSyncPollIntervalSeconds * 1000);

  runtimeLogger.info('Obsidian sync runner started', {
    pollIntervalSeconds: config.obsidianSyncPollIntervalSeconds,
    vaultPath: config.obsidianVaultPath,
    tasksPath: config.obsidianTasksPath,
  });

  return {
    stop() {
      clearInterval(intervalId);
    },
  };
}
