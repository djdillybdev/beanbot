import { describe, expect, test } from 'bun:test';

import { summarizeConflict } from './operator-service';

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
