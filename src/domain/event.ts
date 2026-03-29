export type EventStatus = 'active' | 'deleted';

export interface GoogleCalendarEventRecord {
  id: string;
  calendarId: string;
  title: string;
  normalizedTitle: string;
  startUtc: string;
  endUtc: string;
  startLabel: string;
  location?: string;
  description?: string;
  url?: string | null;
  eventStatus: EventStatus;
  isRecurring: boolean;
}

export interface EventCreateInput {
  title: string;
  start: string;
  end: string;
  location?: string;
  description?: string;
}

export interface EventEditInput {
  title?: string;
  start?: string;
  end?: string;
  location?: string;
  description?: string;
}

export interface EventAutocompleteSuggestion {
  name: string;
  value: string;
}
