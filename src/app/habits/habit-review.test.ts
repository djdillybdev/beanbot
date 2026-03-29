import { describe, expect, test } from 'bun:test';

import {
  buildHabitReviewResult,
  buildHabitStreaks,
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

describe('habit streaks', () => {
  test('counts consecutive local-day completions and stops on a missed day', () => {
    const streaks = buildHabitStreaks(
      new Date('2026-03-29T12:00:00.000Z'),
      'UTC',
      [
        {
          id: '1',
          title: 'Walk',
          normalizedTitle: 'walk',
          labels: ['habit'],
          completedAtUtc: '2026-03-29T07:00:00.000Z',
          url: 'https://example.com/1',
          priority: 1,
        },
        {
          id: '2',
          title: 'Walk',
          normalizedTitle: 'walk',
          labels: ['habit'],
          completedAtUtc: '2026-03-28T07:00:00.000Z',
          url: 'https://example.com/2',
          priority: 1,
        },
        {
          id: '3',
          title: 'Walk',
          normalizedTitle: 'walk',
          labels: ['habit'],
          completedAtUtc: '2026-03-26T07:00:00.000Z',
          url: 'https://example.com/3',
          priority: 1,
        },
      ],
    );

    expect(streaks).toHaveLength(1);
    expect(streaks[0]?.currentStreak).toBe(2);
    expect(streaks[0]?.completedToday).toBe(true);
  });

  test('counts duplicate same-day completions once', () => {
    const review = buildHabitReviewResult(
      new Date('2026-03-29T12:00:00.000Z'),
      'UTC',
      [],
      [],
      [],
      [
        {
          id: '1',
          title: 'Read',
          normalizedTitle: 'read',
          labels: ['habit'],
          completedAtUtc: '2026-03-29T07:00:00.000Z',
          url: 'https://example.com/1',
          priority: 1,
        },
        {
          id: '2',
          title: 'Read',
          normalizedTitle: 'read',
          labels: ['habit'],
          completedAtUtc: '2026-03-29T08:00:00.000Z',
          url: 'https://example.com/2',
          priority: 1,
        },
      ],
      { configured: true, connected: true },
    );

    expect(review.streaks[0]?.currentStreak).toBe(1);
    expect(review.stats.trackedHabitCount).toBe(1);
  });
});
