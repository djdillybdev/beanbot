import { describe, expect, test } from 'bun:test';

import { ObsidianSyncService } from './obsidian-sync-service';
import type { TodoistTaskRecord } from '../../domain/task';
import type { ObsidianExportTask } from '../../db/obsidian-task-repository';

describe('obsidian sync reconciliation', () => {
  test('remote deleted task removes tracked note and tombstones local state', async () => {
    const todoistTask = buildTask({ taskStatus: 'deleted' });
    const existingTask = buildExportTask({ syncStatus: 'synced', taskStatus: 'active' });
    const events: Array<{ eventType: string; result?: string }> = [];
    const deletedPaths: string[] = [];
    const deletedIndexes: string[] = [];
    const upserts: Array<{ taskStatus: string; preservePendingPush?: boolean }> = [];
    const reconciledDeletes: Array<{ taskId: string; source: string | undefined }> = [];

    const service = new ObsidianSyncService(
      { obsidianVaultPath: '/vault' } as never,
      {
        syncObsidianTasks: async () => ({
          tasks: [todoistTask],
          nextSyncToken: 'next',
          fullSync: false,
        }),
      } as never,
      {
        getByTaskId: async () => existingTask,
        upsertFromTodoist: async (task: TodoistTaskRecord, options?: { preservePendingPush?: boolean }) => {
          upserts.push({ taskStatus: task.taskStatus, preservePendingPush: options?.preservePendingPush });
        },
        markReconciledDeleted: async (taskId: string, source?: string) => {
          reconciledDeletes.push({ taskId, source });
        },
        listActiveForExport: async () => [],
      } as never,
      {
        findByTaskId: async () => ({ filePath: 'Tasks/test.md' }),
        deleteByTaskId: async (taskId: string) => {
          deletedIndexes.push(taskId);
        },
      } as never,
      {
        getState: async () => ({ lastIncrementalCursor: 'cursor' }),
        updateIncrementalSync: async () => {},
        touchFullSync: async () => {},
      } as never,
      {
        insert: async (event: { eventType: string; result?: string }) => {
          events.push(event);
        },
      } as never,
      { scan: async () => ({ changedFileCount: 0, createdTaskCount: 0, detectedDeleteCount: 0, conflictCount: 0, errorCount: 0 }) } as never,
      { deletePendingTasks: async () => ({ deletedTaskCount: 0, deleteErrorCount: 0 }) } as never,
      { pushPendingTasks: async () => ({ pushedTaskCount: 0 }) } as never,
      {
        deleteTaskNote: async (relativePath: string) => {
          deletedPaths.push(relativePath);
        },
      } as never,
      buildLogger(),
    );

    await service.runOnce();

    expect(upserts).toEqual([{ taskStatus: 'deleted', preservePendingPush: false }]);
    expect(reconciledDeletes).toEqual([{ taskId: todoistTask.id, source: 'todoist' }]);
    expect(deletedPaths).toEqual(['Tasks/test.md']);
    expect(deletedIndexes).toEqual([todoistTask.id]);
    expect(events.some((event) => event.eventType === 'remote_delete_reconciled')).toBe(true);
  });

  test('pending push is discarded when remote completed state wins', async () => {
    const todoistTask = buildTask({ taskStatus: 'completed' });
    const existingTask = buildExportTask({ syncStatus: 'pending_push', taskStatus: 'active' });
    const events: Array<{ eventType: string; result?: string }> = [];
    const upserts: Array<{ taskStatus: string; preservePendingPush?: boolean }> = [];
    let pushCount = 0;

    const service = new ObsidianSyncService(
      { obsidianVaultPath: '/vault' } as never,
      {
        syncObsidianTasks: async () => ({
          tasks: [todoistTask],
          nextSyncToken: 'next',
          fullSync: false,
        }),
      } as never,
      {
        getByTaskId: async () => existingTask,
        upsertFromTodoist: async (task: TodoistTaskRecord, options?: { preservePendingPush?: boolean }) => {
          upserts.push({ taskStatus: task.taskStatus, preservePendingPush: options?.preservePendingPush });
        },
        listActiveForExport: async () => [],
      } as never,
      {
        findByTaskId: async () => null,
      } as never,
      {
        getState: async () => ({ lastIncrementalCursor: 'cursor' }),
        updateIncrementalSync: async () => {},
        touchFullSync: async () => {},
      } as never,
      {
        insert: async (event: { eventType: string; result?: string }) => {
          events.push(event);
        },
      } as never,
      { scan: async () => ({ changedFileCount: 0, createdTaskCount: 0, detectedDeleteCount: 0, conflictCount: 0, errorCount: 0 }) } as never,
      { deletePendingTasks: async () => ({ deletedTaskCount: 0, deleteErrorCount: 0 }) } as never,
      {
        pushPendingTasks: async () => {
          pushCount += 1;
          return { pushedTaskCount: 0 };
        },
      } as never,
      {} as never,
      buildLogger(),
    );

    await service.runOnce();

    expect(upserts).toEqual([{ taskStatus: 'completed', preservePendingPush: false }]);
    expect(pushCount).toBe(1);
    expect(events.some((event) => event.eventType === 'pending_push_discarded_for_remote_state')).toBe(true);
  });

  test('reset from Todoist deletes tracked notes and skips local delete processing', async () => {
    const todoistTask = buildTask();
    const exportTask = buildExportTask();
    const deletedPaths: string[] = [];
    const upsertedTasks: Array<{ taskId: string; preservePendingPush?: boolean }> = [];
    const events: string[] = [];
    let noteIndexCleared = false;
    let tasksCleared = false;
    let syncStateCleared = false;
    let scanCount = 0;
    let pendingDeleteCount = 0;
    let pendingPushCount = 0;

    const service = new ObsidianSyncService(
      { obsidianVaultPath: '/vault' } as never,
      {
        syncObsidianTasks: async (syncToken: string | null) => {
          expect(syncToken).toBeNull();
          return {
            tasks: [todoistTask],
            nextSyncToken: 'next',
            fullSync: true,
          };
        },
      } as never,
      {
        deleteAll: async () => {
          tasksCleared = true;
        },
        upsertFromTodoist: async (task: TodoistTaskRecord, options?: { preservePendingPush?: boolean }) => {
          upsertedTasks.push({ taskId: task.id, preservePendingPush: options?.preservePendingPush });
        },
        listActiveForExport: async () => [exportTask],
        updateExportMetadata: async () => {},
      } as never,
      {
        listAll: async () => [
          { todoistTaskId: 'task-1', filePath: 'Tasks/task-1.md' },
          { todoistTaskId: 'task-2', filePath: 'Tasks/missing.md' },
        ],
        deleteAll: async () => {
          noteIndexCleared = true;
        },
        findByTaskId: async () => null,
        upsert: async () => {},
      } as never,
      {
        deleteAll: async () => {
          syncStateCleared = true;
        },
        updateIncrementalSync: async () => {},
        touchFullSync: async () => {},
      } as never,
      {
        insert: async (event: { eventType: string }) => {
          events.push(event.eventType);
        },
      } as never,
      {
        scan: async () => {
          scanCount += 1;
          return { changedFileCount: 0, createdTaskCount: 0, detectedDeleteCount: 0, conflictCount: 0, errorCount: 0 };
        },
      } as never,
      {
        deletePendingTasks: async () => {
          pendingDeleteCount += 1;
          return { deletedTaskCount: 0, deleteErrorCount: 0 };
        },
      } as never,
      {
        pushPendingTasks: async () => {
          pendingPushCount += 1;
          return { pushedTaskCount: 0 };
        },
      } as never,
      {
        listTaskNotePaths: async () => ['Tasks/task-1.md', 'Tasks/untracked.md'],
        deleteTaskNote: async (relativePath: string) => {
          deletedPaths.push(relativePath);
          return relativePath !== 'Tasks/missing.md';
        },
        exportTask: async () => ({
          relativePath: 'Tasks/task-1.md',
          contentHash: 'content-hash',
          metadataHash: 'metadata-hash',
          lastFileMtimeUtc: '2026-04-13T00:00:00.000Z',
          noteBody: '',
        }),
      } as never,
      buildLogger(),
    );

    const result = await service.resetFromTodoist();

    expect(deletedPaths).toEqual(['Tasks/task-1.md', 'Tasks/missing.md']);
    expect(noteIndexCleared).toBe(true);
    expect(tasksCleared).toBe(true);
    expect(syncStateCleared).toBe(true);
    expect(upsertedTasks).toEqual([{ taskId: 'task-1', preservePendingPush: false }]);
    expect(scanCount).toBe(0);
    expect(pendingDeleteCount).toBe(0);
    expect(pendingPushCount).toBe(0);
    expect(result.trackedNoteCount).toBe(2);
    expect(result.deletedNoteCount).toBe(1);
    expect(result.missingTrackedNoteCount).toBe(1);
    expect(result.skippedUntrackedNoteCount).toBe(1);
    expect(result.importedTaskCount).toBe(1);
    expect(result.exportedTaskCount).toBe(1);
    expect(events).toContain('obsidian.reset_from_todoist');
  });
});

function buildTask(overrides?: Partial<TodoistTaskRecord>): TodoistTaskRecord {
  return {
    id: 'task-1',
    title: 'Task',
    normalizedTitle: 'task',
    priority: 1,
    recurring: false,
    url: 'https://todoist.test/task-1',
    taskStatus: 'active',
    ...overrides,
  };
}

function buildExportTask(overrides?: Partial<ObsidianExportTask>): ObsidianExportTask {
  return {
    todoistTaskId: 'task-1',
    content: 'Task',
    completed: false,
    priorityApi: 1,
    labels: [],
    recurring: false,
    todoistUrl: 'https://todoist.test/task-1',
    lastSyncedAtUtc: new Date().toISOString(),
    syncStatus: 'synced',
    sourceOfLastChange: 'todoist',
    taskStatus: 'active',
    ...overrides,
  };
}

function buildLogger() {
  return {
    info() {},
    warn() {},
    error() {},
    debug() {},
  } as never;
}
