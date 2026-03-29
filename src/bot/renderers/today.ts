import { EmbedBuilder } from 'discord.js';

import type { AppConfig } from '../../config';
import type { DailyReviewResult, PeriodReviewResult, UpcomingTaskReviewResult } from '../../domain/daily-review';
import { formatLocalDayLabel, formatLocalTime } from '../../utils/time';

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

export function buildTodayStatusEmbeds(
  config: AppConfig,
  dateKey: string,
  review: DailyReviewResult,
  updatedAt: Date,
) {
  return [
    new EmbedBuilder()
      .setTitle(`Today Status · ${formatLocalDayLabel(dateKey, config.timezone)}`)
      .setDescription(`Timezone: ${config.timezone}`)
      .addFields(
        buildTaskField('Overdue', review.overdueTasks),
        buildTaskField('Due Today', review.dueTodayTasks),
        buildCompletedTaskField('Completed', review.completedTodayTasks),
        buildEventField('Events Today', review.todayEvents),
        buildStatusField(
          'Provider Status',
          review.todoistStatus.message,
          review.googleCalendarStatus.message,
        ),
      )
      .setFooter({ text: `Last changed at ${formatLocalTime(updatedAt, config.timezone)}` }),
  ];
}

export function buildWeekStatusEmbeds(
  config: AppConfig,
  periodKey: string,
  review: PeriodReviewResult,
  updatedAt: Date,
) {
  return buildLivePeriodEmbeds(
    `Week Status · ${formatLocalDayLabel(periodKey, config.timezone)}`,
    config.timezone,
    review,
    updatedAt,
    true,
  );
}

export function buildMonthStatusEmbeds(
  config: AppConfig,
  periodKey: string,
  review: PeriodReviewResult,
  updatedAt: Date,
) {
  return buildLivePeriodEmbeds(
    `Month Status · ${periodKey}`,
    config.timezone,
    review,
    updatedAt,
    false,
  );
}

export function buildUpcomingStatusEmbeds(
  config: AppConfig,
  periodKey: string,
  review: UpcomingTaskReviewResult,
  updatedAt: Date,
) {
  const header = new EmbedBuilder()
    .setTitle('Upcoming Tasks · Next 14 Days')
    .setDescription(`Rolling window · Timezone: ${config.timezone}`)
    .addFields(
      buildStatusField('Todoist Status', review.todoistStatus.message, undefined),
    )
    .setFooter({ text: `Last changed at ${formatLocalTime(updatedAt, config.timezone)}` });

  const sections = review.dayGroups.map((group) => renderDayGroup(group.label, group.tasks, []));
  const chunks = chunkSections(sections, 3500);

  if (chunks.length === 0) {
    header.addFields({
      name: 'Upcoming',
      value: 'No upcoming tasks in the next 14 days.',
      inline: false,
    });

    return [header];
  }

  const embeds = [header];

  for (const [index, chunk] of chunks.entries()) {
    embeds.push(
      new EmbedBuilder()
        .setTitle(index === 0 ? 'Upcoming Schedule' : 'Upcoming Schedule (cont.)')
        .setDescription(chunk)
        .setFooter({ text: `Last changed at ${formatLocalTime(updatedAt, config.timezone)}` }),
    );
  }

  return embeds;
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

function buildCompletedTaskField(
  label: string,
  tasks: Array<{ title: string; completedLabel: string; url: string }>,
) {
  return {
    name: label,
    value:
      tasks.length > 0
        ? tasks
            .map((task) => `- [${escapeMarkdown(task.title)}](${task.url}) · ${task.completedLabel}`)
            .join('\n')
            .slice(0, 1024)
        : 'None yet.',
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

function buildLivePeriodEmbeds(
  title: string,
  timezone: string,
  review: PeriodReviewResult,
  updatedAt: Date,
  includeCompleted: boolean,
) {
  const header = new EmbedBuilder()
    .setTitle(title)
    .setDescription(`Timezone: ${timezone}`)
    .addFields(
      buildTaskField('Overdue', review.overdueTasks),
      ...(includeCompleted
        ? [buildCompletedTaskField('Completed', review.completedTasks ?? [])]
        : []),
      buildStatusField('Provider Status', review.todoistStatus.message, review.googleCalendarStatus.message),
    )
    .setFooter({ text: `Last changed at ${formatLocalTime(updatedAt, timezone)}` });

  const sections = review.dayGroups.map((group) => renderDayGroup(group.label, group.tasks, group.events));
  const chunks = chunkSections(sections, 3500);

  if (chunks.length === 0) {
    header.addFields({
      name: 'Upcoming',
      value: 'No upcoming tasks or events in this period.',
      inline: false,
    });

    return [header];
  }

  const embeds = [header];

  for (const [index, chunk] of chunks.entries()) {
    embeds.push(
      new EmbedBuilder()
        .setTitle(index === 0 ? `${title} Schedule` : `${title} Schedule (cont.)`)
        .setDescription(chunk)
        .setFooter({ text: `Last changed at ${formatLocalTime(updatedAt, timezone)}` }),
    );
  }

  return embeds;
}

function renderDayGroup(
  label: string,
  tasks: Array<{ title: string; dueLabel: string; url: string }>,
  events: Array<{ title: string; startLabel: string; url: string | null }>,
) {
  const lines = [`**${label}**`];

  for (const task of tasks) {
    lines.push(`- Task: [${escapeMarkdown(task.title)}](${task.url}) · ${task.dueLabel}`);
  }

  for (const event of events) {
    lines.push(
      event.url
        ? `- Event: [${escapeMarkdown(event.title)}](${event.url}) · ${event.startLabel}`
        : `- Event: ${escapeMarkdown(event.title)} · ${event.startLabel}`,
    );
  }

  return lines.join('\n');
}

function chunkSections(sections: string[], maxLength: number) {
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

function escapeMarkdown(value: string) {
  return value.replaceAll('[', '\\[').replaceAll(']', '\\]');
}
