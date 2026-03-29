import { and, asc, eq, ne } from 'drizzle-orm';

import type { Database } from './types';
import { todayStatusMessage } from './schema';

export interface TodayStatusMessageRecord {
  dateKey: string;
  channelId: string;
  messageId: string;
  snapshotJson: string;
  isPinned: boolean;
  createdAtUtc: string;
  updatedAtUtc: string;
}

export class TodayStatusMessageRepository {
  constructor(private readonly db: Database) {}

  async findByDateKey(dateKey: string, channelId: string): Promise<TodayStatusMessageRecord | null> {
    const row = await this.db.query.todayStatusMessage.findFirst({
      where: and(
        eq(todayStatusMessage.dateKey, dateKey),
        eq(todayStatusMessage.channelId, channelId),
      ),
    });

    return row ? mapRow(row) : null;
  }

  async upsert(record: Omit<TodayStatusMessageRecord, 'createdAtUtc' | 'updatedAtUtc'>) {
    const now = new Date().toISOString();

    await this.db
      .insert(todayStatusMessage)
      .values({
        dateKey: record.dateKey,
        channelId: record.channelId,
        messageId: record.messageId,
        snapshotJson: record.snapshotJson,
        isPinned: record.isPinned,
        updatedAtUtc: now,
      })
      .onConflictDoUpdate({
        target: todayStatusMessage.dateKey,
        set: {
          channelId: record.channelId,
          messageId: record.messageId,
          snapshotJson: record.snapshotJson,
          isPinned: record.isPinned,
          updatedAtUtc: now,
        },
      });
  }

  async markPinned(dateKey: string, isPinned: boolean) {
    await this.db
      .update(todayStatusMessage)
      .set({
        isPinned,
        updatedAtUtc: new Date().toISOString(),
      })
      .where(eq(todayStatusMessage.dateKey, dateKey));
  }

  async listOtherPinned(channelId: string, currentDateKey: string): Promise<TodayStatusMessageRecord[]> {
    const rows = await this.db.query.todayStatusMessage.findMany({
      where: and(
        eq(todayStatusMessage.channelId, channelId),
        eq(todayStatusMessage.isPinned, true),
        ne(todayStatusMessage.dateKey, currentDateKey),
      ),
      orderBy: [asc(todayStatusMessage.dateKey)],
    });

    return rows.map(mapRow);
  }
}

function mapRow(row: typeof todayStatusMessage.$inferSelect): TodayStatusMessageRecord {
  return {
    dateKey: row.dateKey,
    channelId: row.channelId,
    messageId: row.messageId,
    snapshotJson: row.snapshotJson,
    isPinned: row.isPinned,
    createdAtUtc: row.createdAtUtc,
    updatedAtUtc: row.updatedAtUtc,
  };
}
