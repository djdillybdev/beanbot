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
date: "2026-03-30"
---

hello
`);

    const writable = parseWritableFields(parsed.frontmatter, 'UTC');

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

    expect(() => parseWritableFields(parsed.frontmatter, 'UTC')).toThrow('priority_api must be between 1 and 4.');
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
date:
---
`);

    expect(parseWritableFields(parsed.frontmatter, 'UTC')).toEqual({
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

    expect(() => parseWritableFields(parsed.frontmatter, 'UTC')).toThrow('effort must only contain quick, easy, flow, or personal.');
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

    expect(parseWritableFields(parsed.frontmatter, 'UTC')).toEqual({
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

  test('parses new local datetime fields into internal due values', () => {
    const parsed = parseObsidianTaskNote(`---
title: "Write docs"
completed: false
priority_api: 1
labels: []
date: "2026-03-30"
datetime: "2026-03-30T14:45:00"
---
`);

    expect(parseWritableFields(parsed.frontmatter, 'UTC')).toEqual({
      title: 'Write docs',
      completed: false,
      priorityApi: 1,
      project: undefined,
      effort: undefined,
      labels: [],
      dueDate: '2026-03-30',
      dueDatetime: '2026-03-30T14:45:00.000Z',
    });
  });

  test('parses date-only notes without changing due datetime', () => {
    const parsed = parseObsidianTaskNote(`---
title: "Write docs"
completed: false
priority_api: 1
labels: []
date: "2026-03-30"
---
`);

    expect(parseWritableFields(parsed.frontmatter, 'UTC')).toEqual({
      title: 'Write docs',
      completed: false,
      priorityApi: 1,
      project: undefined,
      effort: undefined,
      labels: [],
      dueDate: '2026-03-30',
      dueDatetime: undefined,
    });
  });

  test('reads legacy due_date and due_datetime fields for compatibility', () => {
    const parsed = parseObsidianTaskNote(`---
title: "Write docs"
completed: false
priority_api: 1
labels: []
due_date: "2026-03-30"
due_datetime: "2026-03-30T14:45:00.000Z"
---
`);

    expect(parseWritableFields(parsed.frontmatter, 'UTC')).toEqual({
      title: 'Write docs',
      completed: false,
      priorityApi: 1,
      project: undefined,
      effort: undefined,
      labels: [],
      dueDate: '2026-03-30',
      dueDatetime: '2026-03-30T14:45:00.000Z',
    });
  });

  test('prefers new date and datetime fields over legacy due fields', () => {
    const parsed = parseObsidianTaskNote(`---
title: "Write docs"
completed: false
priority_api: 1
labels: []
date: "2026-03-31"
datetime: "2026-03-31T09:30:00"
due_date: "2026-03-30"
due_datetime: "2026-03-30T14:45:00.000Z"
---
`);

    expect(parseWritableFields(parsed.frontmatter, 'UTC')).toEqual({
      title: 'Write docs',
      completed: false,
      priorityApi: 1,
      project: undefined,
      effort: undefined,
      labels: [],
      dueDate: '2026-03-31',
      dueDatetime: '2026-03-31T09:30:00.000Z',
    });
  });

  test('normalizes date to match datetime when both are present', () => {
    const parsed = parseObsidianTaskNote(`---
title: "Write docs"
completed: false
priority_api: 1
labels: []
date: "2026-03-30"
datetime: "2026-03-31T09:30:00"
---
`);

    expect(parseWritableFields(parsed.frontmatter, 'UTC')).toEqual({
      title: 'Write docs',
      completed: false,
      priorityApi: 1,
      project: undefined,
      effort: undefined,
      labels: [],
      dueDate: '2026-03-31',
      dueDatetime: '2026-03-31T09:30:00.000Z',
    });
  });
});
