import { EmbedBuilder } from 'discord.js';

import type { AppConfig } from '../../config';
import type { DailyReviewResult } from '../../domain/daily-review';

export function buildTodayEmbeds(config: AppConfig, review: DailyReviewResult) {
  return [
    new EmbedBuilder()
      .setTitle('Today')
      .setDescription(`Timezone: ${config.timezone}`)
      .addFields(
        buildTaskField('Overdue', review.overdueTasks),
        buildTaskField('Due Today', review.dueTodayTasks),
        buildEventField('Events Today', review.todayEvents),
        buildStatusField(
          'Provider Status',
          review.todoistStatus.message,
          review.googleCalendarStatus.message,
        ),
      )
      .setTimestamp(new Date()),
  ];
}

function buildTaskField(
  label: string,
  tasks: Array<{ title: string; dueLabel: string; url: string }>,
) {
  return {
    name: label,
    value:
      tasks.length > 0
        ? tasks
            .map((task) => `- [${escapeMarkdown(task.title)}](${task.url}) · ${task.dueLabel}`)
            .join('\n')
            .slice(0, 1024)
        : 'None.',
    inline: false,
  };
}

function buildEventField(
  label: string,
  events: Array<{ title: string; startLabel: string; url: string | null }>,
) {
  return {
    name: label,
    value:
      events.length > 0
        ? events
            .map((event) =>
              event.url
                ? `- [${escapeMarkdown(event.title)}](${event.url}) · ${event.startLabel}`
                : `- ${escapeMarkdown(event.title)} · ${event.startLabel}`,
            )
            .join('\n')
            .slice(0, 1024)
        : 'None.',
    inline: false,
  };
}

function buildStatusField(name: string, todoistMessage?: string, googleMessage?: string) {
  const messages = [todoistMessage, googleMessage].filter(Boolean);

  return {
    name,
    value: messages.length > 0 ? messages.join('\n') : 'Todoist and Google Calendar are connected.',
    inline: false,
  };
}

function escapeMarkdown(value: string) {
  return value.replaceAll('[', '\\[').replaceAll(']', '\\]');
}
