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
  } as never;
}
