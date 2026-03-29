import { desc } from 'drizzle-orm';

import type { Database } from './types';
import { actionLog } from './schema';

export interface ActionLogEntry {
  actionType: string;
  sourceCommand: string;
  payloadJson?: string | null;
  resultJson?: string | null;
}

export class ActionLogRepository {
  constructor(private readonly db: Database) {}

  async insert(entry: ActionLogEntry) {
    await this.db.insert(actionLog).values({
      actionType: entry.actionType,
      sourceCommand: entry.sourceCommand,
      payloadJson: entry.payloadJson ?? null,
      resultJson: entry.resultJson ?? null,
    });
  }
}
