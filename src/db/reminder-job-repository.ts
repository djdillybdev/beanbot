import { and, eq, inArray, lte, sql } from 'drizzle-orm';

import type { Database } from './types';
import { reminderJobs } from './schema';
import type {
  ReminderJobRecord,
  ReminderPayload,
  ReminderStatus,
} from '../domain/reminder';

interface UpsertReminderJobInput {
  id: string;
  sourceType: ReminderJobRecord['sourceType'];
  sourceId: string;
  reminderKind: ReminderJobRecord['reminderKind'];
  dedupeKey: string;
  remindAtUtc: string;
  channelId: string;
  payload: ReminderPayload;
  status?: ReminderStatus;
}

export class ReminderJobRepository {
  constructor(private readonly db: Database) {}

  async upsertPendingJob(input: UpsertReminderJobInput) {
    const existing = await this.db.query.reminderJobs.findFirst({
      where: eq(reminderJobs.dedupeKey, input.dedupeKey),
    });

    if (existing?.status === 'delivered') {
      return;
    }

    const now = new Date().toISOString();

    await this.db
      .insert(reminderJobs)
      .values({
        id: input.id,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        reminderKind: input.reminderKind,
        dedupeKey: input.dedupeKey,
        remindAtUtc: input.remindAtUtc,
        channelId: input.channelId,
        payloadJson: JSON.stringify(input.payload),
        status: input.status ?? 'pending',
        updatedAtUtc: now,
      })
      .onConflictDoUpdate({
        target: reminderJobs.dedupeKey,
        set: {
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          reminderKind: input.reminderKind,
          remindAtUtc: input.remindAtUtc,
          channelId: input.channelId,
          payloadJson: JSON.stringify(input.payload),
          status: input.status ?? 'pending',
          deliveredAtUtc: null,
          updatedAtUtc: now,
        },
      });
  }

  async listDuePendingJobs(nowUtc: string): Promise<ReminderJobRecord[]> {
    const rows = await this.db.query.reminderJobs.findMany({
      where: and(eq(reminderJobs.status, 'pending'), lte(reminderJobs.remindAtUtc, nowUtc)),
      orderBy: [reminderJobs.remindAtUtc],
    });

    return rows.map(mapRowToReminderJobRecord);
  }

  async cancelPendingJobsForSource(sourceType: ReminderJobRecord['sourceType'], sourceId: string) {
    await this.db
      .update(reminderJobs)
      .set({
        status: 'cancelled',
        updatedAtUtc: new Date().toISOString(),
      })
      .where(
        and(
          eq(reminderJobs.sourceType, sourceType),
          eq(reminderJobs.sourceId, sourceId),
          eq(reminderJobs.status, 'pending'),
        ),
      );
  }

  async markDelivered(id: string, deliveredAtUtc: string) {
    await this.db
      .update(reminderJobs)
      .set({
        status: 'delivered',
        deliveredAtUtc,
        updatedAtUtc: deliveredAtUtc,
      })
      .where(eq(reminderJobs.id, id));
  }

  async markFailed(id: string) {
    await this.db
      .update(reminderJobs)
      .set({
        status: 'failed',
        updatedAtUtc: new Date().toISOString(),
      })
      .where(eq(reminderJobs.id, id));
  }

  async markPending(id: string) {
    await this.db
      .update(reminderJobs)
      .set({
        status: 'pending',
        updatedAtUtc: new Date().toISOString(),
      })
      .where(eq(reminderJobs.id, id));
  }

  async resetFailedJobs(nowUtc: string) {
    await this.db
      .update(reminderJobs)
      .set({
        status: 'pending',
        updatedAtUtc: nowUtc,
      })
      .where(eq(reminderJobs.status, 'failed'));
  }

  async pruneFinishedJobs(beforeUtc: string) {
    await this.db
      .delete(reminderJobs)
      .where(
        and(
          inArray(reminderJobs.status, ['delivered', 'cancelled']),
          lte(sql`COALESCE(${reminderJobs.deliveredAtUtc}, ${reminderJobs.updatedAtUtc})`, beforeUtc),
        ),
      );
  }

  async getSummary(nowUtc = new Date().toISOString()) {
    const rows = await this.db.query.reminderJobs.findMany();

    return {
      totalCount: rows.length,
      pendingCount: rows.filter((row) => row.status === 'pending').length,
      failedCount: rows.filter((row) => row.status === 'failed').length,
      duePendingCount: rows.filter((row) => row.status === 'pending' && row.remindAtUtc <= nowUtc).length,
      latestUpdatedAtUtc: rows.reduce<string | null>(
        (latest, row) => (!latest || row.updatedAtUtc > latest ? row.updatedAtUtc : latest),
        null,
      ),
    };
  }
}

function mapRowToReminderJobRecord(row: typeof reminderJobs.$inferSelect): ReminderJobRecord {
  return {
    id: row.id,
    sourceType: row.sourceType as ReminderJobRecord['sourceType'],
    sourceId: row.sourceId,
    reminderKind: row.reminderKind as ReminderJobRecord['reminderKind'],
    dedupeKey: row.dedupeKey,
    remindAtUtc: row.remindAtUtc,
    channelId: row.channelId,
    payload: JSON.parse(row.payloadJson) as ReminderPayload,
    deliveredAtUtc: row.deliveredAtUtc ?? undefined,
    status: row.status as ReminderStatus,
    createdAtUtc: row.createdAtUtc,
    updatedAtUtc: row.updatedAtUtc,
  };
}
