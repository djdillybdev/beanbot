import type { AppConfig } from '../../config';
import { ObsidianLocalScanService } from './obsidian-local-scan';
import { ObsidianPendingDeleteService } from './obsidian-pending-delete-service';
import { ObsidianPendingPushService } from './obsidian-pending-push-service';
import { ObsidianNoteIndexRepository } from '../../db/obsidian-note-index-repository';
import { ObsidianSyncEventRepository } from '../../db/obsidian-sync-event-repository';
import { ObsidianSyncStateRepository } from '../../db/obsidian-sync-state-repository';
import { ObsidianTaskRepository, type ObsidianExportTask } from '../../db/obsidian-task-repository';
import { TodoistClient } from '../../integrations/todoist/client';
import { ObsidianVaultAdapter } from '../../integrations/obsidian/vault-adapter';
import type { Logger } from '../../logging/logger';
import { splitReservedLabels } from './project-labels';
import type { TodoistTaskRecord } from '../../domain/task';

export interface ObsidianResetFromTodoistResult {
  action: 'obsidian.reset_from_todoist';
  result: 'success';
  durationMs: number;
  trackedNoteCount: number;
  deletedNoteCount: number;
  missingTrackedNoteCount: number;
  skippedUntrackedNoteCount: number;
  importedTaskCount: number;
  exportedTaskCount: number;
  wroteFileCount: number;
  nextSyncTokenPresent: boolean;
  fullSync: boolean;
}

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
        const reservedLabels = splitReservedLabels(task.labels);

        if (task.taskStatus === 'deleted') {
          await this.reconcileRemoteDeletedTask(task, existingTask);
          continue;
        }

        if (existingTask?.syncStatus === 'pending_push' && task.taskStatus !== 'active') {
          await this.reconcilePendingPushAgainstRemoteState(task, existingTask);
          continue;
        }

        if (existingTask?.syncStatus === 'pending_delete' && task.taskStatus !== 'active') {
          await this.reconcilePendingDeleteAgainstRemoteState(task, existingTask);
          continue;
        }

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

        if (reservedLabels.hadEffortConflict) {
          await this.syncEventRepository.insert({
            eventType: 'todoist_effort_normalized',
            source: 'todoist',
            todoistTaskId: task.id,
            payloadSummary: JSON.stringify({
              title: task.title,
              labels: task.labels ?? [],
              normalizedEffort: reservedLabels.effort ?? null,
            }),
            result: 'warning',
          });
          this.logger.warn('Normalized conflicting Todoist effort labels', {
            todoistTaskId: task.id,
            labels: task.labels ?? [],
            normalizedEffort: reservedLabels.effort ?? null,
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

      const exportResult = await this.exportActiveTasks();

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
          exportedTaskCount: exportResult.exportedTaskCount,
          wroteFileCount: exportResult.wroteFileCount,
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
        exportedTaskCount: exportResult.exportedTaskCount,
        wroteFileCount: exportResult.wroteFileCount,
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

  async resetFromTodoist(): Promise<ObsidianResetFromTodoistResult> {
    if (!this.config.obsidianVaultPath) {
      throw new Error('OBSIDIAN_VAULT_PATH is required for Obsidian sync.');
    }

    this.logger.warn('Starting Obsidian reset from Todoist', {
      vaultPath: this.config.obsidianVaultPath,
    });
    const startedAt = Date.now();

    try {
      const [noteIndexes, taskNotePaths] = await Promise.all([
        this.noteIndexRepository.listAll(),
        this.vaultAdapter.listTaskNotePaths(),
      ]);
      const trackedPaths = new Set(noteIndexes.map((noteIndex) => noteIndex.filePath));
      const skippedUntrackedNoteCount = taskNotePaths.filter((relativePath) => !trackedPaths.has(relativePath)).length;
      let deletedNoteCount = 0;
      let missingTrackedNoteCount = 0;

      for (const noteIndex of noteIndexes) {
        const deleted = await this.vaultAdapter.deleteTaskNote(noteIndex.filePath);

        if (deleted) {
          deletedNoteCount += 1;
        } else {
          missingTrackedNoteCount += 1;
        }
      }

      await this.noteIndexRepository.deleteAll();
      await this.taskRepository.deleteAll();
      await this.syncStateRepository.deleteAll();

      const inboundSync = await this.todoistClient.syncObsidianTasks(null);

      for (const task of inboundSync.tasks) {
        await this.taskRepository.upsertFromTodoist(task, { preservePendingPush: false });
      }

      await this.syncStateRepository.updateIncrementalSync({
        nextSyncToken: inboundSync.nextSyncToken,
      });
      const exportResult = await this.exportActiveTasks();
      await this.syncStateRepository.touchFullSync();

      const result: ObsidianResetFromTodoistResult = {
        action: 'obsidian.reset_from_todoist',
        result: 'success',
        durationMs: Date.now() - startedAt,
        trackedNoteCount: noteIndexes.length,
        deletedNoteCount,
        missingTrackedNoteCount,
        skippedUntrackedNoteCount,
        importedTaskCount: inboundSync.tasks.length,
        exportedTaskCount: exportResult.exportedTaskCount,
        wroteFileCount: exportResult.wroteFileCount,
        nextSyncTokenPresent: inboundSync.nextSyncToken.length > 0,
        fullSync: inboundSync.fullSync,
      };

      await this.syncEventRepository.insert({
        eventType: 'obsidian.reset_from_todoist',
        source: 'system',
        payloadSummary: JSON.stringify(result),
        result: 'success',
      });
      this.logger.warn('Completed Obsidian reset from Todoist', { ...result });

      return result;
    } catch (error) {
      await this.syncEventRepository.insert({
        eventType: 'obsidian.reset_from_todoist_failed',
        source: 'system',
        payloadSummary: error instanceof Error ? error.message : String(error),
        result: 'error',
      });
      this.logger.error('Obsidian reset from Todoist failed', error, {
        durationMs: Date.now() - startedAt,
      });
      throw error;
    }
  }

  private async reconcileRemoteDeletedTask(task: TodoistTaskRecord, existingTask: ObsidianExportTask | null) {
    const existingIndex = await this.noteIndexRepository.findByTaskId(task.id);

    if (existingIndex) {
      await this.vaultAdapter.deleteTaskNote(existingIndex.filePath);
      await this.noteIndexRepository.deleteByTaskId(task.id);
    }

    await this.taskRepository.upsertFromTodoist(task, { preservePendingPush: false });
    await this.taskRepository.markReconciledDeleted(task.id, 'todoist');
    await this.syncEventRepository.insert({
      eventType: 'remote_delete_reconciled',
      source: 'todoist',
      todoistTaskId: task.id,
      payloadSummary: JSON.stringify({
        hadTrackedNote: existingIndex !== null,
        previousSyncStatus: existingTask?.syncStatus ?? null,
        title: task.title,
      }),
      result: 'reconciled',
    });
    this.logger.info('Reconciled remote Todoist deletion against local Obsidian state', {
      todoistTaskId: task.id,
      hadTrackedNote: existingIndex !== null,
      previousSyncStatus: existingTask?.syncStatus ?? null,
    });
  }

  private async reconcilePendingPushAgainstRemoteState(task: TodoistTaskRecord, existingTask: ObsidianExportTask) {
    await this.taskRepository.upsertFromTodoist(task, { preservePendingPush: false });
    await this.syncEventRepository.insert({
      eventType: 'pending_push_discarded_for_remote_state',
      source: 'system',
      todoistTaskId: task.id,
      payloadSummary: JSON.stringify({
        remoteTaskStatus: task.taskStatus,
        previousSyncStatus: existingTask.syncStatus,
        title: task.title,
      }),
      result: 'reconciled',
    });
    this.logger.info('Discarded local pending Obsidian push because remote task state won', {
      todoistTaskId: task.id,
      remoteTaskStatus: task.taskStatus,
    });
  }

  private async reconcilePendingDeleteAgainstRemoteState(task: TodoistTaskRecord, existingTask: ObsidianExportTask) {
    await this.noteIndexRepository.deleteByTaskId(task.id);
    await this.taskRepository.upsertFromTodoist(task, { preservePendingPush: false });
    await this.taskRepository.markReconciledDeleted(task.id, 'system');
    await this.syncEventRepository.insert({
      eventType: 'local_delete_already_reconciled',
      source: 'system',
      todoistTaskId: task.id,
      payloadSummary: JSON.stringify({
        remoteTaskStatus: task.taskStatus,
        previousSyncStatus: existingTask.syncStatus,
        title: task.title,
      }),
      result: 'reconciled',
    });
    this.logger.info('Reconciled pending local delete because remote task was already non-active', {
      todoistTaskId: task.id,
      remoteTaskStatus: task.taskStatus,
    });
  }

  private async exportActiveTasks() {
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

    return {
      exportedTaskCount: exportTasks.length,
      wroteFileCount: writeCount,
    };
  }
}
