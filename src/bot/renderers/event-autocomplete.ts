import type { GoogleCalendarEventRecord } from '../../domain/event';

export function buildEventAutocompleteLabel(event: GoogleCalendarEventRecord) {
  return `${event.title} · ${event.startLabel}`;
}
