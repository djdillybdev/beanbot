import type { AppConfig } from '../../config';
import { ObsidianLocalScanService } from './obsidian-local-scan';
import { ObsidianPendingDeleteService } from './obsidian-pending-delete-service';
import { ObsidianPendingPushService } from './obsidian-pending-push-service';
import { ObsidianNoteIndexRepository } from '../../db/obsidian-note-index-repository';
import { ObsidianSyncEventRepository } from '../../db/obsidian-sync-event-repository';
import { ObsidianSyncStateRepository } from '../../db/obsidian-sync-state-repository';
import { ObsidianTaskRepository } from '../../db/obsidian-task-repository';
import { TodoistClient } from '../../integrations/todoist/client';
import { ObsidianVaultAdapter } from '../../integrations/obsidian/vault-adapter';
import type { Logger } from '../../logging/logger';

export class ObsidianSyncService {
  constructor(
    private readonly config: AppConfig,
    private readonly todoistClient: TodoistClient,
    private readonly taskRepository: ObsidianTaskRepository,
    private readonly noteIndexRepository: ObsidianNoteIndexRepository,
    private readonly syncStateRepository: ObsidianSyncStateRepository,
    private readonly syncEventRepository: ObsidianSyncEventRepository,
    private readonly localScanService: ObsidianLocalScanService,
    private readonly pendingDeleteService: ObsidianPendingDeleteService,
    private readonly pendingPushService: ObsidianPendingPushService,
    private readonly vaultAdapter: ObsidianVaultAdapter,
    private readonly logger: Logger,
  ) {}

  async runOnce() {
    if (!this.config.obsidianVaultPath) {
      throw new Error('OBSIDIAN_VAULT_PATH is required for Obsidian sync.');
    }

    this.logger.info('Starting Obsidian sync pass', {
      vaultPath: this.config.obsidianVaultPath,
    });

    const startedAt = Date.now();

    try {
      const syncState = await this.syncStateRepository.getState();
      const inboundSync = await this.todoistClient.syncObsidianTasks(syncState?.lastIncrementalCursor ?? null);
      const tasks = inboundSync.tasks;
      let completedTaskCount = 0;
      let uncompletedTaskCount = 0;

      for (const task of tasks) {
        const existingTask = await this.taskRepository.getByTaskId(task.id);

        if (task.taskStatus === 'completed' && existingTask?.taskStatus !== 'completed') {
          completedTaskCount += 1;
          await this.syncEventRepository.insert({
            eventType: 'todoist_completion_detected',
            source: 'todoist',
            todoistTaskId: task.id,
            payloadSummary: JSON.stringify({ title: task.title }),
            result: 'completed',
          });
        }

        if (task.taskStatus === 'active' && existingTask?.taskStatus === 'completed') {
          uncompletedTaskCount += 1;
          await this.syncEventRepository.insert({
            eventType: 'todoist_uncompletion_detected',
            source: 'todoist',
            todoistTaskId: task.id,
            payloadSummary: JSON.stringify({ title: task.title }),
            result: 'active',
          });
        }

        await this.taskRepository.upsertFromTodoist(task);
      }

      await this.syncStateRepository.updateIncrementalSync({
        nextSyncToken: inboundSync.nextSyncToken,
      });

      const scanResult = await this.localScanService.scan();
      const deleteResult = await this.pendingDeleteService.deletePendingTasks();
      const pushResult = await this.pendingPushService.pushPendingTasks();

      const exportTasks = await this.taskRepository.listActiveForExport();
      let writeCount = 0;

      for (const task of exportTasks) {
        const existingIndex = await this.noteIndexRepository.findByTaskId(task.todoistTaskId);
        const exportResult = await this.vaultAdapter.exportTask(task, existingIndex?.filePath ?? null);

        if (!existingIndex || existingIndex.contentHash !== exportResult.contentHash) {
          writeCount += 1;
        }

        await this.noteIndexRepository.upsert({
          todoistTaskId: task.todoistTaskId,
          filePath: exportResult.relativePath,
          contentHash: exportResult.contentHash,
          metadataHash: exportResult.metadataHash,
          lastFileMtimeUtc: exportResult.lastFileMtimeUtc,
        });
        await this.taskRepository.updateExportMetadata(task.todoistTaskId, {
          contentHash: exportResult.metadataHash,
          noteBody: exportResult.noteBody,
        });
      }

      await this.syncStateRepository.touchFullSync();
      await this.syncEventRepository.insert({
        eventType: 'sync.completed',
        source: 'system',
        payloadSummary: JSON.stringify({
          importedTaskCount: tasks.length,
          detectedLocalChangeCount: scanResult.changedFileCount,
          createdTaskCount: scanResult.createdTaskCount,
          detectedDeleteCount: scanResult.detectedDeleteCount,
          deletedTaskCount: deleteResult.deletedTaskCount,
          completedTaskCount,
          uncompletedTaskCount,
          conflictCount: scanResult.conflictCount,
          errorCount: scanResult.errorCount + deleteResult.deleteErrorCount,
          pushedTaskCount: pushResult.pushedTaskCount,
          exportedTaskCount: exportTasks.length,
          wroteFileCount: writeCount,
        }),
        result: 'success',
      });

      this.logger.info('Completed Obsidian sync pass', {
        importedTaskCount: tasks.length,
        detectedLocalChangeCount: scanResult.changedFileCount,
        createdTaskCount: scanResult.createdTaskCount,
        detectedDeleteCount: scanResult.detectedDeleteCount,
        deletedTaskCount: deleteResult.deletedTaskCount,
        completedTaskCount,
        uncompletedTaskCount,
        conflictCount: scanResult.conflictCount,
        errorCount: scanResult.errorCount + deleteResult.deleteErrorCount,
        pushedTaskCount: pushResult.pushedTaskCount,
        exportedTaskCount: exportTasks.length,
        wroteFileCount: writeCount,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      await this.syncEventRepository.insert({
        eventType: 'sync.failed',
        source: 'system',
        payloadSummary: error instanceof Error ? error.message : String(error),
        result: 'error',
      });
      this.logger.error('Obsidian sync pass failed', error, {
        durationMs: Date.now() - startedAt,
      });
      throw error;
    }
  }
}
