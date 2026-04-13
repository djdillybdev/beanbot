import { describe, expect, test } from 'bun:test';

import { OperatorService, summarizeConflict } from './operator-service';

describe('operator service conflict summarization', () => {
  test('marks duplicate identity as manual-only conflict', () => {
    const summary = summarizeConflict(
      buildTask({ syncStatus: 'conflict' }),
      {
        eventType: 'local_note_duplicate_identity',
        payloadSummary: null,
        createdAtUtc: '2026-03-31T12:00:00.000Z',
      },
      'Tasks/123.md',
    );

    expect(summary.kind).toBe('duplicate_identity');
    expect(summary.repairable).toBe(false);
    expect(summary.filePath).toBe('Tasks/123.md');
  });

  test('maps invalid local note errors to re-export', () => {
    const summary = summarizeConflict(
      buildTask({ syncStatus: 'error' }),
      {
        eventType: 'local_change_invalid',
        payloadSummary: '{"error":"invalid"}',
        createdAtUtc: '2026-03-31T12:00:00.000Z',
      },
    );

    expect(summary.kind).toBe('invalid_local_note');
    expect(summary.recommendedAction).toBe('re-export');
    expect(summary.repairable).toBe(true);
  });

  test('maps pending delete states to retry-delete', () => {
    const summary = summarizeConflict(buildTask({ syncStatus: 'pending_delete' }));

    expect(summary.kind).toBe('pending_delete');
    expect(summary.recommendedAction).toBe('retry-delete');
  });
});

describe('operator service Obsidian reset', () => {
  test('optionally clears and rebuilds the Todoist task cache', async () => {
    let taskCacheCleared = false;
    const rememberedTasks: unknown[] = [];
    const actionLogs: unknown[] = [];
    const service = new OperatorService({
      obsidianSyncRuntime: {
        stop() {},
        runOnceNow: async () => {},
        resetFromTodoist: async () => ({
          action: 'obsidian.reset_from_todoist',
          result: 'success',
          durationMs: 10,
          trackedNoteCount: 1,
          deletedNoteCount: 1,
          missingTrackedNoteCount: 0,
          skippedUntrackedNoteCount: 0,
          importedTaskCount: 1,
          exportedTaskCount: 1,
          wroteFileCount: 1,
          nextSyncTokenPresent: true,
          fullSync: true,
        }),
      },
      todoistTaskMapRepository: {
        deleteAll: async () => {
          taskCacheCleared = true;
        },
      },
      todoistClient: {
        getAllActiveTaskRecords: async () => [{ id: 'task-1' }],
      },
      taskService: {
        rememberTasks: async (tasks: unknown[]) => {
          rememberedTasks.push(...tasks);
        },
      },
      actionLogRepository: {
        insert: async (entry: unknown) => {
          actionLogs.push(entry);
        },
      },
    } as never);

    const result = await service.resetObsidianFromTodoist({ includeTaskCache: true });

    expect(taskCacheCleared).toBe(true);
    expect(rememberedTasks).toEqual([{ id: 'task-1' }]);
    expect(result.taskCacheRebuiltCount).toBe(1);
    expect(actionLogs).toHaveLength(1);
  });
});

function buildTask(overrides?: Partial<Parameters<typeof summarizeConflict>[0]>) {
  return {
    todoistTaskId: '123',
    content: 'Test task',
    completed: false,
    priorityApi: 1,
    labels: [],
    recurring: false,
    todoistUrl: 'https://todoist.test/123',
    lastSyncedAtUtc: '2026-03-31T11:00:00.000Z',
    syncStatus: 'error',
    sourceOfLastChange: 'obsidian',
    taskStatus: 'active',
    ...overrides,
  };
}
