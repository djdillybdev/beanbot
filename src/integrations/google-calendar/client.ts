import type { AppConfig } from '../../config';
import type { DailyEventSummary } from '../../domain/daily-review';
import type { StoredOAuthToken } from '../../domain/oauth';
import { OAuthTokenRepository } from '../../db/oauth-token-repository';
import {
  formatLocalTime,
  getLocalDateParts,
  getUpcomingDayBounds,
  getZonedDayBounds,
} from '../../utils/time';
import { GoogleCalendarOAuthService } from './oauth';

interface GoogleCalendarEventResponse {
  id: string;
  htmlLink?: string;
  summary?: string;
  start?: {
    date?: string;
    dateTime?: string;
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
    const url = new URL(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
        this.config.env.GOOGLE_DEFAULT_CALENDAR_ID,
      )}/events`,
    );
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
