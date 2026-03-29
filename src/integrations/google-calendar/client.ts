import type { AppConfig } from '../../config';
import type { DailyEventSummary } from '../../domain/daily-review';
import type { GoogleCalendarEventRecord } from '../../domain/event';
import type { StoredOAuthToken } from '../../domain/oauth';
import { OAuthTokenRepository } from '../../db/oauth-token-repository';
import {
  formatLocalDateTimeInput,
  formatLocalTime,
  getLocalDateParts,
  getUpcomingDayBounds,
  getZonedDayBounds,
} from '../../utils/time';
import { normalizeTaskTitle } from '../../utils/text';
import { GoogleCalendarOAuthService } from './oauth';

interface GoogleCalendarEventResponse {
  id: string;
  htmlLink?: string;
  summary?: string;
  description?: string;
  location?: string;
  status?: string;
  recurringEventId?: string;
  start?: {
    date?: string;
    dateTime?: string;
    timeZone?: string;
  };
  end?: {
    date?: string;
    dateTime?: string;
    timeZone?: string;
  };
}

export class GoogleCalendarClient {
  constructor(
    private readonly config: AppConfig,
    private readonly tokenRepository: OAuthTokenRepository,
    private readonly oauthService: GoogleCalendarOAuthService,
  ) {}

  isConfigured(): boolean {
    return Boolean(
      this.config.env.OAUTH_STATE_SECRET &&
      this.config.env.GOOGLE_CLIENT_ID &&
        this.config.env.GOOGLE_CLIENT_SECRET &&
        this.config.env.GOOGLE_REDIRECT_URI,
    );
  }

  async isConnected(): Promise<boolean> {
    return (await this.tokenRepository.getByProvider('google-calendar')) !== null;
  }

  async getTodayEvents(): Promise<DailyEventSummary[]> {
    return this.getEventsForUpcomingDays(1);
  }

  async getEventsForUpcomingDays(days: number): Promise<DailyEventSummary[]> {
    const token = await this.getUsableToken();
    const now = new Date();
    const bounds =
      days <= 1
        ? getZonedDayBounds(now, this.config.timezone)
        : getUpcomingDayBounds(now, this.config.timezone, days);
    const events = await this.fetchEvents(token, bounds.startUtc, bounds.endUtc);

    return events
      .map((event) => mapEventToSummary(event, this.config.timezone))
      .filter((event): event is DailyEventSummary => event !== null)
      .sort((left, right) => left.startSortKey.localeCompare(right.startSortKey));
  }

  async createEvent(input: {
    title: string;
    startUtc: string;
    endUtc: string;
    location?: string;
    description?: string;
  }): Promise<GoogleCalendarEventRecord> {
    const token = await this.getUsableToken();
    const response = await fetch(this.getEventsUrl(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildMutationPayload(input, this.config.timezone)),
    });

    return this.parseMutationResponse(response, 'create');
  }

  async getEvent(eventId: string): Promise<GoogleCalendarEventRecord> {
    const token = await this.getUsableToken();
    const response = await fetch(this.getEventUrl(eventId), {
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Google Calendar get event failed: ${response.status} ${text}`);
    }

    const payload = (await response.json()) as GoogleCalendarEventResponse;
    return mapEventToRecord(payload, this.config.env.GOOGLE_DEFAULT_CALENDAR_ID, this.config.timezone);
  }

  async updateEvent(
    eventId: string,
    patch: {
      title?: string;
      startUtc?: string;
      endUtc?: string;
      location?: string | null;
      description?: string | null;
    },
  ): Promise<GoogleCalendarEventRecord> {
    const existing = await this.getEvent(eventId);
    const token = await this.getUsableToken();
    const response = await fetch(this.getEventUrl(eventId), {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(
        buildMutationPayload(
          {
            title: patch.title ?? existing.title,
            startUtc: patch.startUtc ?? existing.startUtc,
            endUtc: patch.endUtc ?? existing.endUtc,
            location: patch.location === undefined ? existing.location : patch.location ?? undefined,
            description:
              patch.description === undefined ? existing.description : patch.description ?? undefined,
          },
          this.config.timezone,
        ),
      ),
    });

    return this.parseMutationResponse(response, 'update');
  }

  async deleteEvent(eventId: string): Promise<void> {
    const token = await this.getUsableToken();
    const response = await fetch(this.getEventUrl(eventId), {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Google Calendar delete event failed: ${response.status} ${text}`);
    }
  }

  async getEventRecordsForUpcomingDays(days: number): Promise<GoogleCalendarEventRecord[]> {
    const token = await this.getUsableToken();
    const now = new Date();
    const bounds =
      days <= 1
        ? getZonedDayBounds(now, this.config.timezone)
        : getUpcomingDayBounds(now, this.config.timezone, days);
    const events = await this.fetchEvents(token, bounds.startUtc, bounds.endUtc);

    return events
      .map((event) =>
        mapTimedEventToRecord(
          event,
          this.config.env.GOOGLE_DEFAULT_CALENDAR_ID,
          this.config.timezone,
        ),
      )
      .filter(
        (event): event is GoogleCalendarEventRecord =>
          event !== null && !event.isRecurring && event.eventStatus === 'active',
      );
  }

  private async getUsableToken(): Promise<StoredOAuthToken> {
    const stored = await this.tokenRepository.getByProvider('google-calendar');

    if (!stored) {
      throw new Error('Google Calendar is not connected.');
    }

    if (!stored.expiryUtc || Date.parse(stored.expiryUtc) - Date.now() > 60_000) {
      return stored;
    }

    if (!stored.refreshToken) {
      return stored;
    }

    const refreshed = await this.oauthService.refreshAccessToken(stored.refreshToken);
    await this.tokenRepository.save(refreshed);
    return refreshed;
  }

  private async fetchEvents(token: StoredOAuthToken, timeMin: string, timeMax: string) {
    const url = new URL(this.getEventsUrl());
    url.searchParams.set('timeMin', timeMin);
    url.searchParams.set('timeMax', timeMax);
    url.searchParams.set('singleEvents', 'true');
    url.searchParams.set('orderBy', 'startTime');
    url.searchParams.set('timeZone', this.config.timezone);

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Google Calendar fetch failed: ${response.status} ${text}`);
    }

    const payload = (await response.json()) as { items?: GoogleCalendarEventResponse[] };
    return payload.items ?? [];
  }

  private async parseMutationResponse(response: Response, action: 'create' | 'update') {
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Google Calendar ${action} event failed: ${response.status} ${text}`);
    }

    const payload = (await response.json()) as GoogleCalendarEventResponse;
    return mapEventToRecord(payload, this.config.env.GOOGLE_DEFAULT_CALENDAR_ID, this.config.timezone);
  }

  private getEventsUrl() {
    return `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
      this.config.env.GOOGLE_DEFAULT_CALENDAR_ID,
    )}/events`;
  }

  private getEventUrl(eventId: string) {
    return `${this.getEventsUrl()}/${encodeURIComponent(eventId)}`;
  }
}

function mapEventToSummary(
  event: GoogleCalendarEventResponse,
  timezone: string,
): DailyEventSummary | null {
  const title = event.summary?.trim() || 'Untitled event';

  if (event.start?.dateTime) {
    const start = new Date(event.start.dateTime);

    return {
      id: event.id,
      title,
      dateKey: getLocalDateParts(start, timezone).date,
      startLabel: formatLocalTime(start, timezone),
      startSortKey: start.toISOString(),
      url: event.htmlLink ?? null,
    };
  }

  if (event.start?.date) {
    return {
      id: event.id,
      title,
      dateKey: event.start.date,
      startLabel: 'All day',
      startSortKey: `${event.start.date}T00:00:00.000Z`,
      url: event.htmlLink ?? null,
    };
  }

  return null;
}

function mapEventToRecord(
  event: GoogleCalendarEventResponse,
  calendarId: string,
  timezone: string,
): GoogleCalendarEventRecord {
  if (!event.start?.dateTime || !event.end?.dateTime) {
    throw new Error('Only timed events are supported for Google Calendar mutations.');
  }

  const start = new Date(event.start.dateTime);
  const end = new Date(event.end.dateTime);
  const title = event.summary?.trim() || 'Untitled event';

  return {
    id: event.id,
    calendarId,
    title,
    normalizedTitle: normalizeTaskTitle(title),
    startUtc: start.toISOString(),
    endUtc: end.toISOString(),
    startLabel: buildEventDateTimeLabel(start, end, timezone),
    location: event.location?.trim() || undefined,
    description: event.description?.trim() || undefined,
    url: event.htmlLink ?? null,
    eventStatus: event.status === 'cancelled' ? 'deleted' : 'active',
    isRecurring: Boolean(event.recurringEventId),
  };
}

function mapTimedEventToRecord(
  event: GoogleCalendarEventResponse,
  calendarId: string,
  timezone: string,
): GoogleCalendarEventRecord | null {
  if (!event.start?.dateTime || !event.end?.dateTime) {
    return null;
  }

  return mapEventToRecord(event, calendarId, timezone);
}

function buildEventDateTimeLabel(start: Date, end: Date, timezone: string) {
  const startDateKey = getLocalDateParts(start, timezone).date;
  const endDateKey = getLocalDateParts(end, timezone).date;
  const startInput = formatLocalDateTimeInput(start, timezone);
  const endTime = formatLocalTime(end, timezone);

  if (startDateKey === endDateKey) {
    return `${startInput} - ${endTime}`;
  }

  return `${startInput} - ${formatLocalDateTimeInput(end, timezone)}`;
}

function buildMutationPayload(
  input: {
    title: string;
    startUtc: string;
    endUtc: string;
    location?: string;
    description?: string;
  },
  timezone: string,
) {
  return {
    summary: input.title,
    location: input.location,
    description: input.description,
    start: {
      dateTime: input.startUtc,
      timeZone: timezone,
    },
    end: {
      dateTime: input.endUtc,
      timeZone: timezone,
    },
  };
}
