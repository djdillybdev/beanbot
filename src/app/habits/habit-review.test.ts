import { describe, expect, test } from 'bun:test';

import {
  buildHabitReviewResult,
  splitCompletedTasksByHabitLabel,
  splitTasksByHabitLabel,
} from './habit-review';

describe('habit filtering', () => {
  test('separates habit tasks from planning tasks', () => {
    const tasks = [
      {
        id: '1',
        title: 'Walk',
        priority: 1,
        dateKey: '2026-03-29',
        dueLabel: 'Due today',
        dueSortKey: 'a',
        labels: ['habit'],
        url: 'https://example.com/1',
      },
      {
        id: '2',
        title: 'Ship feature',
        priority: 1,
        dateKey: '2026-03-29',
        dueLabel: 'Due today',
        dueSortKey: 'b',
        labels: ['work'],
        url: 'https://example.com/2',
      },
    ];

    const result = splitTasksByHabitLabel(tasks);

    expect(result.habits).toHaveLength(1);
    expect(result.nonHabits).toHaveLength(1);
    expect(result.habits[0]?.title).toBe('Walk');
    expect(result.nonHabits[0]?.title).toBe('Ship feature');
  });

  test('separates completed habit tasks from planning completions', () => {
    const tasks = [
      {
        id: '1',
        title: 'Walk',
        priority: 1,
        completedAtUtc: '2026-03-29T07:00:00.000Z',
        completedLabel: 'Done',
        completedSortKey: '2026-03-29T07:00:00.000Z',
        labels: ['habit'],
        url: 'https://example.com/1',
      },
      {
        id: '2',
        title: 'Ship feature',
        priority: 1,
        completedAtUtc: '2026-03-29T08:00:00.000Z',
        completedLabel: 'Done',
        completedSortKey: '2026-03-29T08:00:00.000Z',
        labels: ['work'],
        url: 'https://example.com/2',
      },
    ];

    const result = splitCompletedTasksByHabitLabel(tasks);

    expect(result.habits).toHaveLength(1);
    expect(result.nonHabits).toHaveLength(1);
  });
});

describe('habit review stats', () => {
  test('builds stats from precomputed streaks', () => {
    const review = buildHabitReviewResult(
      [],
      [],
      [],
      [
        {
          habitId: 1,
          title: 'Read',
          currentStreak: 3,
          completedToday: true,
        },
        {
          habitId: 2,
          title: 'Meditate',
          currentStreak: 1,
          completedToday: false,
        },
      ],
      { configured: true, connected: true },
    );

    expect(review.stats.trackedHabitCount).toBe(2);
    expect(review.stats.longestCurrentStreak).toBe(3);
  });
});
