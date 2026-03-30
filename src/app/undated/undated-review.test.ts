import { describe, expect, test } from 'bun:test';

import { buildUndatedTaskReview } from './undated-review';

describe('undated review', () => {
  test('splits inbox tasks from project tasks and excludes habits', () => {
    const review = buildUndatedTaskReview(
      [
        {
          id: '1',
          title: 'Inbox task',
          priority: 1,
          projectName: 'Inbox',
          url: 'https://example.com/1',
        },
        {
          id: '2',
          title: 'Project task',
          priority: 1,
          projectId: 'proj',
          projectName: 'Work',
          url: 'https://example.com/2',
        },
        {
          id: '3',
          title: 'Habit task',
          priority: 1,
          projectId: 'inbox',
          projectName: 'Inbox',
          labels: ['habit'],
          url: 'https://example.com/3',
        },
      ],
      { configured: true, connected: true },
    );

    expect(review.tasks).toHaveLength(2);
    expect(review.tasks.map((task) => task.projectName)).toEqual(['Inbox', 'Work']);
  });

  test('sorts tasks by priority then title within groups', () => {
    const review = buildUndatedTaskReview(
      [
        {
          id: '1',
          title: 'Bravo',
          priority: 1,
          projectName: 'Inbox',
          url: 'https://example.com/1',
        },
        {
          id: '2',
          title: 'Alpha',
          priority: 4,
          projectName: 'Inbox',
          url: 'https://example.com/2',
        },
      ],
      { configured: true, connected: true },
    );

    expect(review.tasks.map((task) => task.title)).toEqual(['Alpha', 'Bravo']);
  });
});
