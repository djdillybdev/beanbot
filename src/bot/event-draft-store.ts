import type { GoogleCalendarEventRecord } from '../domain/event';
import { formatLocalDateTimeInput, parseLocalDateTimeInput } from '../utils/time';

const DEFAULT_TTL_MS = 30 * 60 * 1000;

export interface EventDraft {
  id: string;
  mode: 'add' | 'edit';
  eventId?: string;
  title: string;
  location?: string;
  description?: string;
  selectedDate?: string;
  selectedHour?: string;
  selectedMinute?: string;
  selectedDurationMinutes?: number;
  existingStartUtc?: string;
  existingEndUtc?: string;
  expiresAt: number;
}

export class EventDraftStore {
  private readonly drafts = new Map<string, EventDraft>();

  constructor(private readonly ttlMs = DEFAULT_TTL_MS) {}

  createForAdd(defaults?: {
    title?: string;
    location?: string;
    description?: string;
    selectedDate?: string;
    selectedHour?: string;
    selectedMinute?: string;
    selectedDurationMinutes?: number;
  }): EventDraft {
    return this.save({
      id: crypto.randomUUID(),
      mode: 'add',
      title: defaults?.title ?? '',
      location: defaults?.location,
      description: defaults?.description,
      selectedDate: defaults?.selectedDate,
      selectedHour: defaults?.selectedHour,
      selectedMinute: defaults?.selectedMinute,
      selectedDurationMinutes: defaults?.selectedDurationMinutes,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  createForEdit(
    event: GoogleCalendarEventRecord,
    timezone: string,
    defaults?: {
      selectedDate?: string;
      selectedHour?: string;
      selectedMinute?: string;
      selectedDurationMinutes?: number;
    },
  ): EventDraft {
    return this.save({
      id: crypto.randomUUID(),
      mode: 'edit',
      eventId: event.id,
      title: event.title,
      location: event.location,
      description: event.description,
      selectedDate: defaults?.selectedDate,
      selectedHour: defaults?.selectedHour,
      selectedMinute: defaults?.selectedMinute,
      selectedDurationMinutes: defaults?.selectedDurationMinutes,
      existingStartUtc: event.startUtc,
      existingEndUtc: event.endUtc,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  get(draftId: string): EventDraft | null {
    this.pruneExpired();
    const draft = this.drafts.get(draftId);

    if (!draft) {
      return null;
    }

    draft.expiresAt = Date.now() + this.ttlMs;
    return draft;
  }

  update(draftId: string, patch: Partial<Omit<EventDraft, 'id' | 'mode' | 'expiresAt'>>) {
    const draft = this.get(draftId);

    if (!draft) {
      return null;
    }

    Object.assign(draft, patch);
    draft.expiresAt = Date.now() + this.ttlMs;
    return draft;
  }

  delete(draftId: string) {
    this.drafts.delete(draftId);
  }

  getCurrentStartInput(draft: EventDraft, timezone: string): string {
    if (hasPickerSelection(draft)) {
      return `${draft.selectedDate!} ${draft.selectedHour!}:${draft.selectedMinute!}`;
    }

    if (draft.existingStartUtc) {
      return formatLocalDateTimeInput(new Date(draft.existingStartUtc), timezone);
    }

    return '';
  }

  getCurrentEndInput(draft: EventDraft, timezone: string): string {
    if (hasPickerSelection(draft)) {
      const start = parseLocalDateTimeInput(
        `${draft.selectedDate!} ${draft.selectedHour!}:${draft.selectedMinute!}`,
        timezone,
      );
      const end = new Date(start.getTime() + (draft.selectedDurationMinutes ?? 60) * 60_000);
      return formatLocalDateTimeInput(end, timezone);
    }

    if (draft.existingEndUtc) {
      return formatLocalDateTimeInput(new Date(draft.existingEndUtc), timezone);
    }

    return '';
  }

  private save(draft: EventDraft): EventDraft {
    this.pruneExpired();
    this.drafts.set(draft.id, draft);
    return draft;
  }

  private pruneExpired() {
    const now = Date.now();

    for (const [draftId, draft] of this.drafts.entries()) {
      if (draft.expiresAt <= now) {
        this.drafts.delete(draftId);
      }
    }
  }
}

function hasPickerSelection(draft: EventDraft) {
  return Boolean(
    draft.selectedDate &&
      draft.selectedHour &&
      draft.selectedMinute &&
      draft.selectedDurationMinutes,
  );
}
