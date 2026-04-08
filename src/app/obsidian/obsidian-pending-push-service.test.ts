import { describe, expect, test } from 'bun:test';

import { ObsidianPendingPushService } from './obsidian-pending-push-service';
import type { ObsidianExportTask } from '../../db/obsidian-task-repository';
import type { TodoistTaskRecord } from '../../domain/task';

describe('obsidian pending push recurrence safety', () => {
  test('does not flatten recurring task due fields when pushing metadata-only edits', async () => {
    const patches: Array<Record<string, unknown>> = [];

    const service = new ObsidianPendingPushService(
      {
        getTask: async () => buildTask({ recurring: true, dueString: 'every day', dueDate: '2026-04-08' }),
        updateTask: async (_taskId: string, patch: Record<string, unknown>) => {
          patches.push(patch);
          return buildTask({ recurring: true });
        },
      } as never,
      {
        getByTaskId: async () => buildExportTask({ dueDate: '2026-04-08' }),
        markSyncedAfterPush: async () => {},
      } as never,
      {
        insert: async () => {},
      } as never,
      buildLogger(),
    );

    await service.retryTask('task-1');

    expect(patches).toHaveLength(1);
    expect(patches[0]?.due_date).toBeUndefined();
    expect(patches[0]?.due_datetime).toBeUndefined();
    expect(patches[0]?.due_string).toBeUndefined();
  });

  test('still clears due fields for non-recurring tasks when the local note removes a date', async () => {
    const patches: Array<Record<string, unknown>> = [];

    const service = new ObsidianPendingPushService(
      {
        getTask: async () => buildTask({ recurring: false, dueDate: '2026-04-08' }),
        updateTask: async (_taskId: string, patch: Record<string, unknown>) => {
          patches.push(patch);
          return buildTask({ recurring: false });
        },
      } as never,
      {
        getByTaskId: async () => buildExportTask({ dueDate: undefined, dueDatetimeUtc: undefined }),
        markSyncedAfterPush: async () => {},
      } as never,
      {
        insert: async () => {},
      } as never,
      buildLogger(),
    );

    await service.retryTask('task-1');

    expect(patches).toHaveLength(1);
    expect(patches[0]?.due_string).toBeNull();
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
    syncStatus: 'pending_push',
    sourceOfLastChange: 'obsidian',
    taskStatus: 'active',
    ...overrides,
  };
}

function buildLogger() {
  return {
    warn() {},
    error() {},
  } as never;
}
