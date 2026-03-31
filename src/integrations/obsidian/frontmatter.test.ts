import { describe, expect, test } from 'bun:test';

import { parseObsidianTaskNote, parseWritableFields } from './frontmatter';

describe('obsidian frontmatter parser', () => {
  test('parses exported task frontmatter and body', () => {
    const parsed = parseObsidianTaskNote(`---
todoist_id: "123"
title: "Write docs"
completed: false
priority_api: 4
project: "Beanbot"
effort:
  - "quick"
labels:
  - "docs"
  - "writing"
due_date: "2026-03-30"
due_datetime: null
---

hello
`);

    const writable = parseWritableFields(parsed.frontmatter);

    expect(writable).toEqual({
      title: 'Write docs',
      completed: false,
      priorityApi: 4,
      project: 'Beanbot',
      effort: 'quick',
      labels: ['docs', 'writing'],
      dueDate: '2026-03-30',
      dueDatetime: undefined,
    });
    expect(parsed.body).toBe('hello\n');
  });

  test('rejects invalid priority values', () => {
    const parsed = parseObsidianTaskNote(`---
title: "Write docs"
completed: false
priority_api: 9
labels: []
---
`);

    expect(() => parseWritableFields(parsed.frontmatter)).toThrow('priority_api must be between 1 and 4.');
  });

  test('treats blank scalar properties as unset instead of invalid arrays', () => {
    const parsed = parseObsidianTaskNote(`---
todoist_id: "123"
title: "Write docs"
completed: false
priority_api: 1
project:
effort:
labels: []
due_date:
due_datetime:
---
`);

    expect(parseWritableFields(parsed.frontmatter)).toEqual({
      title: 'Write docs',
      completed: false,
      priorityApi: 1,
      project: undefined,
      effort: undefined,
      labels: [],
      dueDate: undefined,
      dueDatetime: undefined,
    });
  });

  test('rejects invalid effort values', () => {
    const parsed = parseObsidianTaskNote(`---
title: "Write docs"
completed: false
priority_api: 1
effort:
  - "huge"
labels: []
---
`);

    expect(() => parseWritableFields(parsed.frontmatter)).toThrow('effort must only contain quick, easy, flow, or personal.');
  });

  test('normalizes multiple effort values to one', () => {
    const parsed = parseObsidianTaskNote(`---
title: "Write docs"
completed: false
priority_api: 1
effort:
  - "flow"
  - "easy"
labels: []
---
`);

    expect(parseWritableFields(parsed.frontmatter)).toEqual({
      title: 'Write docs',
      completed: false,
      priorityApi: 1,
      project: undefined,
      effort: 'easy',
      labels: [],
      dueDate: undefined,
      dueDatetime: undefined,
    });
  });
});
