import { describe, expect, test } from 'bun:test';

import { mergeReservedLabels, parseEffortList, splitReservedLabels } from './project-labels';

describe('obsidian reserved labels', () => {
  test('splits project and effort from generic labels', () => {
    expect(splitReservedLabels(['quick', 'docs', 'proj:bean-bot'])).toEqual({
      project: 'Bean Bot',
      effort: 'quick',
      labels: ['docs'],
      hadEffortConflict: false,
    });
  });

  test('normalizes conflicting effort labels deterministically', () => {
    expect(splitReservedLabels(['flow', 'easy', 'docs'])).toEqual({
      project: undefined,
      effort: 'easy',
      labels: ['docs'],
      hadEffortConflict: true,
    });
  });

  test('merges generic labels with reserved labels for Todoist', () => {
    expect(mergeReservedLabels('Bean Bot', 'quick', ['docs'])).toEqual(['docs', 'proj:bean-bot', 'quick']);
  });

  test('normalizes effort list values', () => {
    expect(parseEffortList(['flow', 'quick'])).toEqual({
      effort: 'quick',
      hadConflict: true,
    });
  });
});
