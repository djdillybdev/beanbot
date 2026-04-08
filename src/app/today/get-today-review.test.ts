import { describe, expect, test } from 'bun:test';

import { TodayReviewService } from './get-today-review';

describe('today review habit refresh', () => {
  test('refreshes from all active tasks before deriving habit streaks', async () => {
    let rememberedActiveTasks = 0;

    const service = new TodayReviewService(
      {
        timezone: 'UTC',
        publicBaseUrl: 'https://beanbot.test',
      } as never,
      {
        isConfigured: () => true,
        isConnected: async () => true,
        getDailyTasks: async () => ({ overdueTasks: [], dueTodayTasks: [] }),
        getAllActiveTaskRecords: async () => [
          {
            id: 'habit-1',
            title: 'Walk',
            normalizedTitle: 'walk',
            priority: 1,
            recurring: true,
            dueDate: '2026-04-09',
            dueString: 'every day',
            labels: ['habit'],
            url: 'https://todoist.test/habit-1',
            taskStatus: 'active',
          },
        ],
        getCompletedTasksForToday: async () => [],
      } as never,
      {
        isConfigured: () => false,
        isConnected: async () => false,
      } as never,
      {} as never,
      {
        recordExternalCompletions: async () => {},
        listCompletedForLocalDate: async () => [],
        listActiveStreaks: async () => (
          rememberedActiveTasks > 0
            ? [{ habitId: 'habit-1', title: 'Walk', currentStreak: 4, completedToday: false }]
            : []
        ),
        listActiveUnparsedHabits: async () => [],
      } as never,
      {
        rememberTasks: async (tasks: Array<{ id: string }>) => {
          rememberedActiveTasks = tasks.length;
        },
      } as never,
      undefined,
      undefined,
    );

    const review = await service.getHabitReview(new Date('2026-04-08T12:00:00.000Z'));

    expect(rememberedActiveTasks).toBe(1);
    expect(review.stats.trackedHabitCount).toBe(1);
    expect(review.streaks[0]?.habitId).toBe('habit-1');
  });
});
