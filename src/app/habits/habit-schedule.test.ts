import { describe, expect, test } from 'bun:test';

import { computeHabitMetrics, normalizeHabitSchedule } from './habit-schedule';

describe('habit schedule normalization', () => {
  test('parses daily schedules', () => {
    expect(normalizeHabitSchedule('every day', true)).toEqual({
      kind: 'daily',
      rawText: 'every day',
    });
  });

  test('parses weekday schedules', () => {
    expect(normalizeHabitSchedule('every weekday', true)).toEqual({
      kind: 'weekly_days',
      rawText: 'every weekday',
      daysOfWeek: ['mon', 'tue', 'wed', 'thu', 'fri'],
    });
  });

  test('parses named weekday schedules', () => {
    expect(normalizeHabitSchedule('every monday, wednesday and friday', true)).toEqual({
      kind: 'weekly_days',
      rawText: 'every monday, wednesday and friday',
      daysOfWeek: ['mon', 'wed', 'fri'],
    });
  });

  test('parses interval schedules', () => {
    expect(normalizeHabitSchedule('every 3 days', true)).toEqual({
      kind: 'interval_days',
      rawText: 'every 3 days',
      intervalDays: 3,
    });
  });

  test('marks unsupported schedules as unparsed', () => {
    expect(normalizeHabitSchedule('every first business day', true)).toEqual({
      kind: 'unparsed',
      rawText: 'every first business day',
    });
  });
});

describe('habit metrics', () => {
  test('keeps weekday streaks across weekends', () => {
    const metrics = computeHabitMetrics('2026-03-30', {
      kind: 'weekly_days',
      daysOfWeek: ['mon', 'tue', 'wed', 'thu', 'fri'],
      rawText: 'every weekday',
    }, ['2026-03-26', '2026-03-27']);

    expect(metrics.currentStreak).toBe(2);
    expect(metrics.longestStreak).toBe(2);
  });

  test('does not reset a daily streak before today is actually missed', () => {
    const metrics = computeHabitMetrics('2026-03-30', { kind: 'daily', rawText: 'every day' }, [
      '2026-03-28',
      '2026-03-29',
    ]);

    expect(metrics.currentStreak).toBe(2);
  });

  test('breaks daily streaks when a scheduled day is missed', () => {
    const metrics = computeHabitMetrics('2026-03-30', { kind: 'daily', rawText: 'every day' }, [
      '2026-03-27',
      '2026-03-29',
    ]);

    expect(metrics.currentStreak).toBe(1);
    expect(metrics.longestStreak).toBe(1);
  });

  test('treats duplicate interval-day completions as one completion', () => {
    const metrics = computeHabitMetrics('2026-03-30', { kind: 'interval_days', intervalDays: 3 }, [
      '2026-03-20',
      '2026-03-23',
      '2026-03-23',
      '2026-03-26',
      '2026-03-29',
    ]);

    expect(metrics.currentStreak).toBe(4);
    expect(metrics.longestStreak).toBe(4);
    expect(metrics.completionCount).toBe(4);
  });

  test('does not claim a streak for unparsed schedules', () => {
    const metrics = computeHabitMetrics('2026-03-30', { kind: 'unparsed', rawText: 'custom' }, [
      '2026-03-29',
      '2026-03-30',
    ]);

    expect(metrics.currentStreak).toBe(0);
    expect(metrics.longestStreak).toBe(0);
  });
});
