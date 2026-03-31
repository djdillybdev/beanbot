import { and, desc, eq, inArray, like, or } from 'drizzle-orm';

import type { Database } from './types';
import { calendarEventMap } from './schema';
import type { EventStatus, GoogleCalendarEventRecord } from '../domain/event';

interface CalendarEventMapRowInput {
  id: string;
  calendarId: string;
  normalizedTitle: string;
  title: string;
  startUtc: string;
  endUtc: string;
  startLabel: string;
  location?: string;
  description?: string;
  url?: string | null;
  eventStatus: EventStatus;
  isRecurring: boolean;
}

export class CalendarEventMapRepository {
  constructor(private readonly db: Database) {}

  async upsert(event: CalendarEventMapRowInput) {
    const now = new Date().toISOString();

    await this.db
      .insert(calendarEventMap)
      .values({
        googleEventId: event.id,
        calendarId: event.calendarId,
        normalizedTitle: event.normalizedTitle,
        lastSeenSummary: event.title,
        lastSeenStartUtc: event.startUtc,
        lastSeenEndUtc: event.endUtc,
        lastSeenLocation: event.location ?? null,
        lastSeenDescription: event.description ?? null,
        lastSeenStartLabel: event.startLabel,
        lastSeenUrl: event.url ?? null,
        eventStatus: event.eventStatus,
        isRecurring: event.isRecurring,
        updatedAtUtc: now,
      })
      .onConflictDoUpdate({
        target: calendarEventMap.googleEventId,
        set: {
          calendarId: event.calendarId,
          normalizedTitle: event.normalizedTitle,
          lastSeenSummary: event.title,
          lastSeenStartUtc: event.startUtc,
          lastSeenEndUtc: event.endUtc,
          lastSeenLocation: event.location ?? null,
          lastSeenDescription: event.description ?? null,
          lastSeenStartLabel: event.startLabel,
          lastSeenUrl: event.url ?? null,
          eventStatus: event.eventStatus,
          isRecurring: event.isRecurring,
          updatedAtUtc: now,
        },
      });
  }

  async updateStatus(eventId: string, eventStatus: EventStatus) {
    await this.db
      .update(calendarEventMap)
      .set({
        eventStatus,
        updatedAtUtc: new Date().toISOString(),
      })
      .where(eq(calendarEventMap.googleEventId, eventId));
  }

  async findById(eventId: string, statuses?: EventStatus[]): Promise<GoogleCalendarEventRecord | null> {
    const row = await this.db.query.calendarEventMap.findFirst({
      where: statuses
        ? and(eq(calendarEventMap.googleEventId, eventId), inArray(calendarEventMap.eventStatus, statuses))
        : eq(calendarEventMap.googleEventId, eventId),
    });

    return row ? mapRowToEventRecord(row) : null;
  }

  async getAutocompleteCandidates(
    normalizedQuery: string,
    statuses: EventStatus[],
  ): Promise<GoogleCalendarEventRecord[]> {
    const query = normalizedQuery.trim();

    const rows = await this.db.query.calendarEventMap.findMany({
      where:
        query.length === 0
          ? and(
              inArray(calendarEventMap.eventStatus, statuses),
              eq(calendarEventMap.isRecurring, false),
            )
          : and(
              inArray(calendarEventMap.eventStatus, statuses),
              eq(calendarEventMap.isRecurring, false),
              or(
                like(calendarEventMap.normalizedTitle, `${escapeLike(query)}%`),
                like(calendarEventMap.normalizedTitle, `%${escapeLike(query)}%`),
              ),
            ),
      orderBy: [desc(calendarEventMap.updatedAtUtc)],
      limit: 50,
    });

    return rows.map(mapRowToEventRecord);
  }

  async getCacheSummary() {
    const rows = await this.db.query.calendarEventMap.findMany();

    return {
      totalCount: rows.length,
      activeCount: rows.filter((row) => row.eventStatus === 'active').length,
      deletedCount: rows.filter((row) => row.eventStatus === 'deleted').length,
      recurringCount: rows.filter((row) => row.isRecurring).length,
      latestUpdatedAtUtc: rows.reduce<string | null>(
        (latest, row) => (!latest || row.updatedAtUtc > latest ? row.updatedAtUtc : latest),
        null,
      ),
    };
  }
}

function mapRowToEventRecord(row: typeof calendarEventMap.$inferSelect): GoogleCalendarEventRecord {
  return {
    id: row.googleEventId,
    calendarId: row.calendarId,
    title: row.lastSeenSummary,
    normalizedTitle: row.normalizedTitle,
    startUtc: row.lastSeenStartUtc,
    endUtc: row.lastSeenEndUtc,
    startLabel: row.lastSeenStartLabel,
    location: row.lastSeenLocation ?? undefined,
    description: row.lastSeenDescription ?? undefined,
    url: row.lastSeenUrl,
    eventStatus: row.eventStatus as EventStatus,
    isRecurring: row.isRecurring,
  };
}

function escapeLike(value: string) {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}
