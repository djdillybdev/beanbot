import { buildEventAutocompleteLabel } from '../../bot/renderers/event-autocomplete';
import { ActionLogRepository } from '../../db/action-log-repository';
import { CalendarEventMapRepository } from '../../db/calendar-event-map-repository';
import type {
  EventAutocompleteSuggestion,
  EventCreateInput,
  EventEditInput,
  GoogleCalendarEventRecord,
} from '../../domain/event';
import { GoogleCalendarClient } from '../../integrations/google-calendar/client';
import { normalizeTaskTitle } from '../../utils/text';
import {
  formatLocalDateTimeInput,
  parseLocalDateTimeInput,
} from '../../utils/time';

export class EventService {
  constructor(
    private readonly googleCalendarClient: GoogleCalendarClient,
    private readonly eventMapRepository: CalendarEventMapRepository,
    private readonly actionLogRepository: ActionLogRepository,
    private readonly timezone: string,
  ) {}

  async addEvent(input: EventCreateInput): Promise<GoogleCalendarEventRecord> {
    const normalized = normalizeCreateOrEditInput(input, this.timezone);
    const event = await this.googleCalendarClient.createEvent(normalized);
    await this.eventMapRepository.upsert(event);
    await this.actionLogRepository.insert({
      actionType: 'event.add',
      sourceCommand: '/event add',
      payloadJson: JSON.stringify(input),
      resultJson: JSON.stringify(event),
    });

    return event;
  }

  async getEventForEdit(eventId: string): Promise<GoogleCalendarEventRecord | null> {
    const cachedEvent = await this.eventMapRepository.findById(eventId, ['active']);

    if (!cachedEvent) {
      return null;
    }

    try {
      const freshEvent = await this.googleCalendarClient.getEvent(eventId);

      if (freshEvent.isRecurring) {
        return null;
      }

      await this.eventMapRepository.upsert(freshEvent);
      return freshEvent;
    } catch {
      return cachedEvent.isRecurring ? null : cachedEvent;
    }
  }

  async editEvent(eventId: string, input: EventEditInput): Promise<GoogleCalendarEventRecord> {
    const existingEvent = await this.eventMapRepository.findById(eventId, ['active']);

    if (!existingEvent) {
      throw new Error('That event is no longer available in the recent event cache.');
    }

    if (existingEvent.isRecurring) {
      throw new Error('Recurring Google Calendar events are view-only in phase 3.');
    }

    const normalized = normalizeCreateOrEditInput(
      {
        title: input.title ?? existingEvent.title,
        start: input.start ?? formatLocalDateTimeInput(new Date(existingEvent.startUtc), this.timezone),
        end: input.end ?? formatLocalDateTimeInput(new Date(existingEvent.endUtc), this.timezone),
        location: input.location,
        description: input.description,
      },
      this.timezone,
    );

    const patch: {
      title?: string;
      startUtc?: string;
      endUtc?: string;
      location?: string | null;
      description?: string | null;
    } = {};

    if (normalized.title !== existingEvent.title) {
      patch.title = normalized.title;
    }

    if (normalized.startUtc !== existingEvent.startUtc) {
      patch.startUtc = normalized.startUtc;
    }

    if (normalized.endUtc !== existingEvent.endUtc) {
      patch.endUtc = normalized.endUtc;
    }

    if ((normalized.location ?? null) !== (existingEvent.location ?? null)) {
      patch.location = normalized.location ?? null;
    }

    if ((normalized.description ?? null) !== (existingEvent.description ?? null)) {
      patch.description = normalized.description ?? null;
    }

    if (Object.keys(patch).length === 0) {
      return existingEvent;
    }

    const event = await this.googleCalendarClient.updateEvent(eventId, patch);
    await this.eventMapRepository.upsert(event);
    await this.actionLogRepository.insert({
      actionType: 'event.edit',
      sourceCommand: '/event edit',
      payloadJson: JSON.stringify({ eventId, input }),
      resultJson: JSON.stringify(event),
    });

    return event;
  }

  async deleteEvent(eventId: string): Promise<GoogleCalendarEventRecord> {
    const event = await this.eventMapRepository.findById(eventId, ['active']);

    if (!event) {
      throw new Error('That event is no longer available in the recent event cache.');
    }

    if (event.isRecurring) {
      throw new Error('Recurring Google Calendar events are view-only in phase 3.');
    }

    await this.googleCalendarClient.deleteEvent(eventId);
    await this.eventMapRepository.updateStatus(eventId, 'deleted');
    await this.actionLogRepository.insert({
      actionType: 'event.delete',
      sourceCommand: '/event delete',
      payloadJson: JSON.stringify({ eventId }),
      resultJson: JSON.stringify(event),
    });

    return { ...event, eventStatus: 'deleted' };
  }

  async rememberEvents(events: GoogleCalendarEventRecord[]) {
    for (const event of events) {
      await this.eventMapRepository.upsert(event);
    }
  }

  async getEventAutocompleteSuggestions(query: string): Promise<EventAutocompleteSuggestion[]> {
    const normalizedQuery = normalizeTaskTitle(query);
    const events = await this.eventMapRepository.getAutocompleteCandidates(normalizedQuery, ['active']);

    return rankAutocompleteEvents(events, normalizedQuery).slice(0, 25).map((event) => ({
      name: buildEventAutocompleteLabel(event),
      value: event.id,
    }));
  }
}

function normalizeCreateOrEditInput(
  input: Pick<EventCreateInput, 'title' | 'start' | 'end' | 'location' | 'description'>,
  timezone: string,
) {
  const title = input.title.trim();

  if (title.length === 0) {
    throw new Error('Event title cannot be blank.');
  }

  const start = parseLocalDateTimeInput(input.start, timezone);
  const end = parseLocalDateTimeInput(input.end, timezone);

  if (start >= end) {
    throw new Error('Event end must be after the start time.');
  }

  return {
    title,
    startUtc: start.toISOString(),
    endUtc: end.toISOString(),
    location: normalizeOptionalField(input.location),
    description: normalizeOptionalField(input.description),
  };
}

function normalizeOptionalField(value?: string) {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : undefined;
}

function rankAutocompleteEvents(events: GoogleCalendarEventRecord[], normalizedQuery: string) {
  const query = normalizedQuery.trim();

  return [...events].sort((left, right) => {
    const leftRank = getAutocompleteRank(left.normalizedTitle, query);
    const rightRank = getAutocompleteRank(right.normalizedTitle, query);

    return (
      leftRank - rightRank ||
      left.startUtc.localeCompare(right.startUtc) ||
      left.title.localeCompare(right.title)
    );
  });
}

function getAutocompleteRank(title: string, query: string) {
  if (query.length === 0) {
    return 3;
  }

  if (title === query) {
    return 0;
  }

  if (title.startsWith(query)) {
    return 1;
  }

  if (title.includes(query)) {
    return 2;
  }

  return 3;
}
