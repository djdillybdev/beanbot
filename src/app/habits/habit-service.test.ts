import { describe, expect, test } from 'bun:test';

import { classifyHabitTaskStatus } from './habit-service';

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
