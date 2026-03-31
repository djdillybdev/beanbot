import { desc, eq, inArray } from 'drizzle-orm';

import { obsidianSyncEvent } from './schema';
import type { Database } from './types';

export class ObsidianSyncEventRepository {
  constructor(private readonly db: Database) {}

  async insert(input: {
    eventType: string;
    source: string;
    todoistTaskId?: string;
    payloadSummary?: string;
    result?: string;
  }) {
    await this.db.insert(obsidianSyncEvent).values({
      eventType: input.eventType,
      source: input.source,
      todoistTaskId: input.todoistTaskId ?? null,
      payloadSummary: input.payloadSummary ?? null,
      result: input.result ?? null,
    });
  }

  async listRecent(limit = 10) {
    return this.db.query.obsidianSyncEvent.findMany({
      orderBy: (table, { desc }) => [desc(table.createdAtUtc)],
      limit,
    });
  }

  async listRecentByTaskIds(taskIds: string[], limit = 100) {
    if (taskIds.length === 0) {
      return [];
    }

    return this.db.query.obsidianSyncEvent.findMany({
      where: inArray(obsidianSyncEvent.todoistTaskId, taskIds),
      orderBy: [desc(obsidianSyncEvent.createdAtUtc)],
      limit,
    });
  }

  async listRecentByTaskId(todoistTaskId: string, limit = 20) {
    return this.db.query.obsidianSyncEvent.findMany({
      where: eq(obsidianSyncEvent.todoistTaskId, todoistTaskId),
      orderBy: [desc(obsidianSyncEvent.createdAtUtc)],
      limit,
    });
  }
}
