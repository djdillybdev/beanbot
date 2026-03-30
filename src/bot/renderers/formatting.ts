import type { APIEmbedField } from 'discord.js';

import type {
  CompletedTaskSummary,
  DailyEventSummary,
  DailyTaskSummary,
  ProviderStatus,
  ReviewDayGroup,
  UndatedTaskSummary,
} from '../../domain/daily-review';
import type { GoogleCalendarEventRecord } from '../../domain/event';
import type { TodoistTaskRecord } from '../../domain/task';

const EMBED_FIELD_LIMIT = 1024;

export function escapeMarkdown(value: string): string {
  return value.replaceAll('[', '\\[').replaceAll(']', '\\]');
}

export function formatTaskLine(task: Pick<DailyTaskSummary, 'title' | 'dueLabel' | 'url'>): string {
  return `${buildLinkedTitle(task.title, task.url)}${formatSecondaryText(task.dueLabel)}`;
}

export function formatTaskRecordLine(task: TodoistTaskRecord): string {
  return `${buildLinkedTitle(task.title, task.url)}${formatSecondaryText(task.dueLabel)}`;
}

export function formatUndatedTaskLine(task: Pick<UndatedTaskSummary, 'title' | 'projectName' | 'url'>): string {
  return `${buildLinkedTitle(task.title, task.url)} - ${escapeMarkdown(task.projectName ?? 'Inbox')}`;
}

export function formatCompletedTaskLine(
  task: Pick<CompletedTaskSummary, 'title' | 'completedLabel' | 'url'>,
): string {
  return `${buildLinkedTitle(task.title, task.url)}${formatSecondaryText(task.completedLabel)}`;
}

export function formatEventLine(
  event: Pick<DailyEventSummary, 'title' | 'startLabel' | 'url'>,
): string {
  return `${escapeMarkdown(event.startLabel)} · ${event.url ? buildLinkedTitle(event.title, event.url) : escapeMarkdown(event.title)}`;
}

export function formatEventRecordLine(event: GoogleCalendarEventRecord): string {
  return `${escapeMarkdown(event.startLabel)} · ${event.url ? buildLinkedTitle(event.title, event.url) : escapeMarkdown(event.title)}`;
}

export function buildTaskField(
  label: string,
  tasks: Array<Pick<DailyTaskSummary, 'title' | 'dueLabel' | 'url'>>,
  emptyState = 'None.',
): APIEmbedField {
  return buildListField(label, tasks.map(formatTaskLine), emptyState);
}

export function buildCompletedTaskField(
  label: string,
  tasks: Array<Pick<CompletedTaskSummary, 'title' | 'completedLabel' | 'url'>>,
  emptyState = 'None yet.',
): APIEmbedField {
  return buildListField(label, tasks.map(formatCompletedTaskLine), emptyState);
}

export function buildEventField(
  label: string,
  events: Array<Pick<DailyEventSummary, 'title' | 'startLabel' | 'url'>>,
  emptyState = 'None.',
): APIEmbedField {
  return buildListField(label, events.map(formatEventLine), emptyState);
}

export function buildUndatedTaskField(
  label: string,
  tasks: Array<Pick<UndatedTaskSummary, 'title' | 'projectName' | 'url'>>,
  emptyState = 'None.',
): APIEmbedField {
  return buildListField(label, tasks.map(formatUndatedTaskLine), emptyState);
}

export function buildProviderStatusField(
  todoistStatus: ProviderStatus,
  googleCalendarStatus?: ProviderStatus,
): APIEmbedField {
  const messages = [todoistStatus.message, googleCalendarStatus?.message].filter(Boolean);
  const defaultMessage = googleCalendarStatus
    ? 'Todoist and Google Calendar are connected.'
    : 'Todoist is connected.';

  return {
    name: '🔌 Connections',
    value: messages.length > 0 ? truncateField(messages.join('\n')) : defaultMessage,
    inline: false,
  };
}

export function renderDayGroup(
  group: Pick<ReviewDayGroup, 'label' | 'tasks' | 'events'>,
  options?: { taskOnly?: boolean },
): string {
  const lines = [`**${group.label}**`];

  for (const task of group.tasks) {
    lines.push(formatTaskLine(task));
  }

  if (!options?.taskOnly) {
    for (const event of group.events) {
      lines.push(formatEventLine(event));
    }
  }

  return lines.join('\n');
}

export function chunkSections(sections: string[], maxLength: number): string[] {
  const chunks: string[] = [];
  let current = '';

  for (const section of sections) {
    const next = current.length === 0 ? section : `${current}\n\n${section}`;

    if (next.length <= maxLength) {
      current = next;
      continue;
    }

    if (current.length > 0) {
      chunks.push(current);
    }

    current = section;
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks;
}

export function getSummaryColor(options: {
  overdueCount?: number;
  primaryCount?: number;
  completedCount?: number;
}): number {
  if ((options.overdueCount ?? 0) > 0) {
    return 0xcc4433;
  }

  if ((options.primaryCount ?? 0) > 0) {
    return 0xd4a017;
  }

  if ((options.completedCount ?? 0) > 0) {
    return 0x2f855a;
  }

  return 0x4a5568;
}

export function truncateField(value: string): string {
  return value.length <= EMBED_FIELD_LIMIT ? value : `${value.slice(0, EMBED_FIELD_LIMIT - 3)}...`;
}

export function buildMetricField(label: string, value: string): APIEmbedField {
  return {
    name: label,
    value: truncateField(value),
    inline: true,
  };
}

function buildLinkedTitle(title: string, url: string): string {
  return `[${escapeMarkdown(title)}](${url})`;
}

function buildListField(label: string, lines: string[], emptyState: string): APIEmbedField {
  return {
    name: label,
    value: lines.length > 0 ? truncateField(lines.join('\n')) : emptyState,
    inline: false,
  };
}

function formatSecondaryText(value?: string): string {
  return value && value.length > 0 ? ` · ${escapeMarkdown(value)}` : '';
}
