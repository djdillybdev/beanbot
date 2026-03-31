import { describe, expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { ObsidianLocalScanService } from './obsidian-local-scan';
import type { ObsidianExportTask } from '../../db/obsidian-task-repository';

describe('obsidian local scan reconciliation', () => {
  test('missing note for completed remote task is reconciled instead of marked pending delete', async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), 'beanbot-obsidian-scan-'));
    const events: Array<{ eventType: string; result?: string }> = [];
    const reconciledDeletes: Array<{ taskId: string; source?: string }> = [];
    const pendingDeletes: string[] = [];
    const deletedIndexes: string[] = [];

    const service = new ObsidianLocalScanService(
      {
        obsidianVaultPath: vaultRoot,
        obsidianTasksPath: 'Tasks',
        timezone: 'UTC',
      } as never,
      {
        listAll: async () => [{ todoistTaskId: 'task-1', filePath: 'Tasks/task-1.md' }],
        deleteByTaskId: async (taskId: string) => {
          deletedIndexes.push(taskId);
        },
      } as never,
      {
        getByTaskId: async () => buildExportTask({ taskStatus: 'completed' }),
        markReconciledDeleted: async (taskId: string, source?: string) => {
          reconciledDeletes.push({ taskId, source });
        },
        markPendingDelete: async (taskId: string) => {
          pendingDeletes.push(taskId);
        },
      } as never,
      {
        insert: async (event: { eventType: string; result?: string }) => {
          events.push(event);
        },
      } as never,
      {
        touchVaultScan: async () => {},
      } as never,
      {
        createFromUntrackedNotes: async () => ({ createdTaskCount: 0 }),
      } as never,
      buildLogger(),
    );

    const result = await service.scan();

    expect(result.detectedDeleteCount).toBe(1);
    expect(reconciledDeletes).toEqual([{ taskId: 'task-1', source: 'system' }]);
    expect(deletedIndexes).toEqual(['task-1']);
    expect(pendingDeletes).toEqual([]);
    expect(events.some((event) => event.eventType === 'local_delete_already_reconciled')).toBe(true);
  });
});

function buildExportTask(overrides?: Partial<ObsidianExportTask>): ObsidianExportTask {
  return {
    todoistTaskId: 'task-1',
    content: 'Task',
    completed: true,
    priorityApi: 1,
    labels: [],
    recurring: false,
    todoistUrl: 'https://todoist.test/task-1',
    lastSyncedAtUtc: new Date().toISOString(),
    syncStatus: 'synced',
    sourceOfLastChange: 'todoist',
    taskStatus: 'completed',
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
