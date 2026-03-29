import type { ReminderPayload, TaskOverdueReminderPayload } from '../../domain/reminder';
import { formatLocalDateTimeInput } from '../../utils/time';

export function buildReminderMessage(payload: ReminderPayload, timezone: string): string {
  if (payload.kind === 'task_overdue') {
    const parts = [
      '⏰ Task overdue',
      `**${payload.title}**`,
      payload.projectName ? `Project: ${payload.projectName}` : null,
      payload.dueLabel ? payload.dueLabel : `Overdue on ${payload.localDate}`,
      payload.url,
    ];

    return parts.filter(Boolean).join('\n');
  }

  if (payload.kind === 'task_due_soon') {
    const dueAt = formatLocalDateTimeInput(new Date(payload.dueDateTimeUtc), timezone);
    const parts = [
      '⏳ Task due soon',
      `**${payload.title}**`,
      payload.projectName ? `Project: ${payload.projectName}` : null,
      `Due at ${dueAt}`,
      payload.url,
    ];

    return parts.filter(Boolean).join('\n');
  }

  const startsAt = formatLocalDateTimeInput(new Date(payload.startUtc), timezone);
  const parts = [
    '🗓 Upcoming event',
    `**${payload.title}**`,
    `${startsAt}`,
    payload.location ? `Location: ${payload.location}` : null,
    payload.url ?? null,
  ];

  return parts.filter(Boolean).join('\n');
}

export function buildOverdueReminderBatchMessage(payloads: TaskOverdueReminderPayload[]): string {
  const sorted = [...payloads].sort((left, right) => {
    return right.priority - left.priority || left.title.localeCompare(right.title);
  });
  const lines = sorted.map((payload) => {
    const suffix = [payload.projectName, payload.dueLabel].filter(Boolean).join(' · ');
    return suffix.length > 0
      ? `• **${payload.title}** · ${suffix}\n${payload.url}`
      : `• **${payload.title}**\n${payload.url}`;
  });

  return ['⏰ Overdue tasks', ...lines].join('\n');
}
