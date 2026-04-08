import { describe, expect, test } from 'bun:test';

import { HabitService, classifyHabitTaskStatus } from './habit-service';

describe('habit active task status', () => {
  test('classifies overdue recurring habits', () => {
    expect(
      classifyHabitTaskStatus(
        {
          dueDate: '2026-03-29',
          dueDateTimeUtc: undefined,
        },
        '2026-03-30',
      ),
    ).toBe('overdue');
  });

  test('classifies habits due today', () => {
    expect(
      classifyHabitTaskStatus(
        {
          dueDate: '2026-03-30',
          dueDateTimeUtc: undefined,
        },
        '2026-03-30',
      ),
    ).toBe('due_today');
  });

  test('classifies future recurring habits after completion rollover', () => {
    expect(
      classifyHabitTaskStatus(
        {
          dueDate: '2026-03-31',
          dueDateTimeUtc: undefined,
        },
        '2026-03-30',
      ),
    ).toBe('future');
  });
});

describe('habit service derived queries', () => {
  test('filters completed habits by current task qualification', async () => {
    const service = new HabitService(
      'UTC',
      {
        listCurrentHabitTasks: async () => [
          {
            id: 'task-1',
            title: 'Walk',
            normalizedTitle: 'walk',
            priority: 1,
            recurring: true,
            labels: ['habit'],
            url: 'https://example.com/task-1',
            updatedAtUtc: '2026-03-30T09:00:00.000Z',
            taskStatus: 'active',
          },
        ],
      } as never,
      {
        listByLocalDate: async () => [
          {
            eventKey: 'todoist_external:task-1:2026-03-30T07:00:00.000Z',
            todoistTaskId: 'task-1',
            normalizedTitle: 'walk',
            title: 'Walk',
            priority: 1,
            completedAtUtc: '2026-03-30T07:00:00.000Z',
            completedLocalDate: '2026-03-30',
            source: 'todoist_external',
            recurring: true,
            labels: ['habit'],
            url: 'https://example.com/task-1',
            provisional: false,
            createdAtUtc: '2026-03-30T07:00:00.000Z',
          },
          {
            eventKey: 'todoist_external:task-2:2026-03-30T08:00:00.000Z',
            todoistTaskId: 'task-2',
            normalizedTitle: 'read',
            title: 'Read',
            priority: 1,
            completedAtUtc: '2026-03-30T08:00:00.000Z',
            completedLocalDate: '2026-03-30',
            source: 'todoist_external',
            recurring: true,
            labels: ['habit'],
            url: 'https://example.com/task-2',
            provisional: false,
            createdAtUtc: '2026-03-30T08:00:00.000Z',
          },
        ],
      } as never,
    );

    const completed = await service.listCompletedForLocalDate('2026-03-30');

    expect(completed).toHaveLength(1);
    expect(completed[0]?.task.id).toBe('task-1');
  });

  test('computes streaks on demand from current tasks and task completions', async () => {
    const service = new HabitService(
      'UTC',
      {
        listCurrentHabitTasks: async () => [
          {
            id: 'task-1',
            title: 'Walk',
            normalizedTitle: 'walk',
            priority: 1,
            recurring: true,
            dueDate: '2026-03-30',
            dueString: 'every day',
            labels: ['habit'],
            url: 'https://example.com/task-1',
            updatedAtUtc: '2026-03-30T09:00:00.000Z',
            taskStatus: 'active',
          },
        ],
      } as never,
      {
        listForTask: async () => [
          {
            eventKey: 'e1',
            todoistTaskId: 'task-1',
            normalizedTitle: 'walk',
            title: 'Walk',
            priority: 1,
            completedAtUtc: '2026-03-29T07:00:00.000Z',
            completedLocalDate: '2026-03-29',
            source: 'todoist_external',
            recurring: true,
            labels: ['habit'],
            url: 'https://example.com/task-1',
            provisional: false,
            createdAtUtc: '2026-03-29T07:00:00.000Z',
          },
          {
            eventKey: 'e2',
            todoistTaskId: 'task-1',
            normalizedTitle: 'walk',
            title: 'Walk',
            priority: 1,
            completedAtUtc: '2026-03-30T07:00:00.000Z',
            completedLocalDate: '2026-03-30',
            source: 'todoist_external',
            recurring: true,
            labels: ['habit'],
            url: 'https://example.com/task-1',
            provisional: false,
            createdAtUtc: '2026-03-30T07:00:00.000Z',
          },
        ],
      } as never,
    );

    const streaks = await service.listActiveStreaks(new Date('2026-03-30T12:00:00.000Z'));

    expect(streaks).toHaveLength(1);
    expect(streaks[0]?.habitId).toBe('task-1');
    expect(streaks[0]?.currentStreak).toBe(2);
    expect(streaks[0]?.completedToday).toBe(true);
  });
});
