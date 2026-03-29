export type ReminderSourceType = 'task' | 'event';

export type ReminderKind = 'task_overdue' | 'task_due_soon' | 'event_upcoming';

export type ReminderStatus = 'pending' | 'delivered' | 'failed' | 'cancelled';

export interface TaskOverdueReminderPayload {
  kind: 'task_overdue';
  title: string;
  projectName?: string;
  dueLabel?: string;
  priority: number;
  url: string;
  localDate: string;
}

export interface TaskDueSoonReminderPayload {
  kind: 'task_due_soon';
  title: string;
  projectName?: string;
  priority: number;
  dueDateTimeUtc: string;
  dueLabel?: string;
  url: string;
}

export interface EventUpcomingReminderPayload {
  kind: 'event_upcoming';
  title: string;
  startUtc: string;
  startLabel: string;
  location?: string;
  url?: string | null;
}

export type ReminderPayload =
  | TaskOverdueReminderPayload
  | TaskDueSoonReminderPayload
  | EventUpcomingReminderPayload;

export interface ReminderJobRecord {
  id: string;
  sourceType: ReminderSourceType;
  sourceId: string;
  reminderKind: ReminderKind;
  dedupeKey: string;
  remindAtUtc: string;
  channelId: string;
  payload: ReminderPayload;
  deliveredAtUtc?: string;
  status: ReminderStatus;
  createdAtUtc: string;
  updatedAtUtc: string;
}
