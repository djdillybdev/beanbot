import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { ObsidianVaultAdapter } from './vault-adapter';

const noopLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child() {
    return this;
  },
  async attachDiscordChannel() {},
};

const createdDirs: string[] = [];

describe('obsidian vault adapter', () => {
  afterEach(async () => {
    while (createdDirs.length > 0) {
      const directory = createdDirs.pop();
      if (directory) {
        await rm(directory, { recursive: true, force: true });
      }
    }
  });

  test('exports to stable todoist id filenames', async () => {
    const root = await mkdtemp(join(tmpdir(), 'beanbot-obsidian-'));
    createdDirs.push(root);
    const adapter = new ObsidianVaultAdapter(root, 'Tasks/todoist', noopLogger);

    const result = await adapter.exportTask(buildTask());

    expect(result.relativePath).toBe('Tasks/todoist/123.md');
    const content = await readFile(join(root, result.relativePath), 'utf8');
    expect(content).toContain('title: "Write docs"');
    expect(content).toContain('effort:\n  - "quick"');
    expect(content).toContain('aliases:\n  - "Write docs"');
  });

  test('migrates an older title-based file to the stable id path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'beanbot-obsidian-'));
    createdDirs.push(root);
    const titlePath = join(root, 'Tasks/todoist/Write docs.md');
    await mkdir(join(root, 'Tasks/todoist'), { recursive: true });
    await writeFile(
      titlePath,
      `---
todoist_id: "123"
title: "Write docs"
completed: false
priority_api: 4
effort:
  - "quick"
labels: []
---

hello
`,
      'utf8',
    );

    const adapter = new ObsidianVaultAdapter(root, 'Tasks/todoist', noopLogger);
    const result = await adapter.exportTask(buildTask(), 'Tasks/todoist/Write docs.md');

    expect(result.relativePath).toBe('Tasks/todoist/123.md');
    expect(await readFile(join(root, 'Tasks/todoist/123.md'), 'utf8')).toContain('hello');
  });
});

function buildTask() {
  return {
    todoistTaskId: '123',
    content: 'Write docs',
    completed: false,
    priorityApi: 4,
    effort: 'quick' as const,
    labels: [],
    recurring: false,
    todoistUrl: 'https://app.todoist.com/app/task/123',
    lastSyncedAtUtc: '2026-03-30T00:00:00.000Z',
    syncStatus: 'synced',
    sourceOfLastChange: 'todoist',
    taskStatus: 'active',
  };
}
