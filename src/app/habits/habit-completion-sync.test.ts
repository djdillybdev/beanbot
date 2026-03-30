import { describe, expect, test } from 'bun:test';

import { buildExternalHabitCompletionRecords, buildHabitCompletionRecordFromTask } from './habit-completion-sync';

describe('habit completion sync', () => {
  test('builds a bot completion record only for habit-labeled tasks', () => {
    const record = buildHabitCompletionRecordFromTask(
      {
        id: 'task-1',
        normalizedTitle: 'walk',
        title: 'Walk',
        priority: 1,
        projectId: 'proj-1',
        projectName: 'Personal',
        url: 'https://example.com/task-1',
        labels: ['habit'],
      },
      '2026-03-29T07:00:00.000Z',
      'UTC',
      'bot',
    );

    expect(record).not.toBeNull();
    expect(record?.dedupeKey).toBe('task-1:2026-03-29');
    expect(record?.source).toBe('bot');
  });

  test('matches external completions only by known habit task id', () => {
    const records = buildExternalHabitCompletionRecords(
      [
        {
          id: 'task-1',
          title: 'Walk',
          priority: 1,
          completedAtUtc: '2026-03-29T07:00:00.000Z',
          completedLabel: 'Done',
          completedSortKey: '2026-03-29T07:00:00.000Z',
          url: 'https://example.com/task-1',
        },
        {
          id: 'task-2',
          title: 'Write',
          priority: 1,
          completedAtUtc: '2026-03-29T08:00:00.000Z',
          completedLabel: 'Done',
          completedSortKey: '2026-03-29T08:00:00.000Z',
          url: 'https://example.com/task-2',
        },
      ],
      new Map([
        [
          'task-1',
          {
            id: 'task-1',
            normalizedTitle: 'walk',
            title: 'Walk',
            priority: 1,
            projectId: 'proj-1',
            projectName: 'Personal',
            url: 'https://example.com/task-1',
            labels: ['habit'],
            taskStatus: 'completed',
          },
        ],
        [
          'task-2',
          {
            id: 'task-2',
            normalizedTitle: 'write',
            title: 'Write',
            priority: 1,
            projectId: 'proj-1',
            projectName: 'Work',
            url: 'https://example.com/task-2',
            labels: ['work'],
            taskStatus: 'completed',
          },
        ],
      ]),
      'UTC',
    );

    expect(records).toHaveLength(1);
    expect(records[0]?.todoistTaskId).toBe('task-1');
    expect(records[0]?.source).toBe('todoist_external');
  });

  test('ignores external completions for unknown tasks', () => {
    const records = buildExternalHabitCompletionRecords(
      [
        {
          id: 'task-unknown',
          title: 'Walk',
          priority: 1,
          completedAtUtc: '2026-03-29T07:00:00.000Z',
          completedLabel: 'Done',
          completedSortKey: '2026-03-29T07:00:00.000Z',
          url: 'https://example.com/task-unknown',
        },
      ],
      new Map(),
      'UTC',
    );

    expect(records).toHaveLength(0);
  });
});
