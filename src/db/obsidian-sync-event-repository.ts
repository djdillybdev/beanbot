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
}
