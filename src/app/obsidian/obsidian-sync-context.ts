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

export interface ObsidianSyncContext {
  syncService: ObsidianSyncService;
  syncStateRepository: ObsidianSyncStateRepository;
  syncEventRepository: ObsidianSyncEventRepository;
}

export function createObsidianSyncContext(
  config: AppConfig,
  db: Database,
  todoistClient: TodoistClient,
  logger: Logger,
): ObsidianSyncContext {
  const taskRepository = new ObsidianTaskRepository(db);
  const noteIndexRepository = new ObsidianNoteIndexRepository(db);
  const syncStateRepository = new ObsidianSyncStateRepository(db);
  const syncEventRepository = new ObsidianSyncEventRepository(db);
  const vaultAdapter = new ObsidianVaultAdapter(
    config.obsidianVaultPath!,
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

  return {
    syncService: new ObsidianSyncService(
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
    ),
    syncStateRepository,
    syncEventRepository,
  };
}
