import { and, asc, eq, ne } from 'drizzle-orm';

import type { Database } from './types';
import { periodStatusMessage } from './schema';

export type PeriodStatusType = 'today' | 'week' | 'month';

export interface PeriodStatusMessageRecord {
  statusType: PeriodStatusType;
  periodKey: string;
  channelId: string;
  messageId: string;
  snapshotJson: string;
  isPinned: boolean;
  createdAtUtc: string;
  updatedAtUtc: string;
}

export class PeriodStatusMessageRepository {
  constructor(private readonly db: Database) {}

  async find(statusType: PeriodStatusType, periodKey: string, channelId: string): Promise<PeriodStatusMessageRecord | null> {
    const row = await this.db.query.periodStatusMessage.findFirst({
      where: and(
        eq(periodStatusMessage.statusType, statusType),
        eq(periodStatusMessage.periodKey, periodKey),
        eq(periodStatusMessage.channelId, channelId),
      ),
    });

    return row ? mapRow(row) : null;
  }

  async upsert(record: Omit<PeriodStatusMessageRecord, 'createdAtUtc' | 'updatedAtUtc'>) {
    const now = new Date().toISOString();

    await this.db
      .insert(periodStatusMessage)
      .values({
        statusType: record.statusType,
        periodKey: record.periodKey,
        channelId: record.channelId,
        messageId: record.messageId,
        snapshotJson: record.snapshotJson,
        isPinned: record.isPinned,
        updatedAtUtc: now,
      })
      .onConflictDoUpdate({
        target: [periodStatusMessage.statusType, periodStatusMessage.periodKey],
        set: {
          channelId: record.channelId,
          messageId: record.messageId,
          snapshotJson: record.snapshotJson,
          isPinned: record.isPinned,
          updatedAtUtc: now,
        },
      });
  }

  async markPinned(statusType: PeriodStatusType, periodKey: string, isPinned: boolean) {
    await this.db
      .update(periodStatusMessage)
      .set({
        isPinned,
        updatedAtUtc: new Date().toISOString(),
      })
      .where(and(
        eq(periodStatusMessage.statusType, statusType),
        eq(periodStatusMessage.periodKey, periodKey),
      ));
  }

  async listOtherPinned(statusType: PeriodStatusType, channelId: string, currentPeriodKey: string) {
    const rows = await this.db.query.periodStatusMessage.findMany({
      where: and(
        eq(periodStatusMessage.statusType, statusType),
        eq(periodStatusMessage.channelId, channelId),
        eq(periodStatusMessage.isPinned, true),
        ne(periodStatusMessage.periodKey, currentPeriodKey),
      ),
      orderBy: [asc(periodStatusMessage.periodKey)],
    });

    return rows.map(mapRow);
  }
}

function mapRow(row: typeof periodStatusMessage.$inferSelect): PeriodStatusMessageRecord {
  return {
    statusType: row.statusType as PeriodStatusType,
    periodKey: row.periodKey,
    channelId: row.channelId,
    messageId: row.messageId,
    snapshotJson: row.snapshotJson,
    isPinned: row.isPinned,
    createdAtUtc: row.createdAtUtc,
    updatedAtUtc: row.updatedAtUtc,
  };
}
