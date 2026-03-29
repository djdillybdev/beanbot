import {
  type AutocompleteInteraction,
  EmbedBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
} from 'discord.js';

import { TodayReviewService } from '../app/today/get-today-review';
import { TaskService } from '../app/tasks/task-service';
import { buildTodayEmbeds } from './renderers/today';
import type { AppConfig } from '../config';
import type { DailyEventSummary, DailyTaskSummary, PeriodReviewResult } from '../domain/daily-review';
import { buildTaskAddSuccessEmbed, buildTaskDoneSuccessEmbed, buildTaskResolutionMessage } from './renderers/task';

export interface CommandDependencies {
  config: AppConfig;
  todayReviewService: TodayReviewService;
  taskService: TaskService;
}

export async function handleChatInputCommand(
  interaction: ChatInputCommandInteraction,
  dependencies: CommandDependencies,
): Promise<void> {
  if (interaction.commandName === 'ping') {
    const latencyMs = Date.now() - interaction.createdTimestamp;
    await interaction.reply({
      content: `Pong. Gateway heartbeat looks healthy. Interaction latency: ${latencyMs}ms.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (interaction.commandName === 'help') {
    await interaction.reply({
      content: [
        'Beanbot commands:',
        '`/ping` checks bot health.',
        '`/help` shows the current command surface.',
        '`/today` shows overdue tasks, tasks due today, and today’s events.',
        '`/week` shows overdue work and the next 7 days.',
        '`/month` shows overdue work and the next 31 days.',
        '`/task add` creates a Todoist task.',
        '`/task done` completes a recently seen task by exact title.',
        '',
        'Connect providers:',
        `- Todoist: ${dependencies.config.publicBaseUrl}/auth/todoist/start`,
        `- Google Calendar: ${dependencies.config.publicBaseUrl}/auth/google/start`,
        '',
        'Intended channel layout:',
        '- `#inbox` for command entry',
        '- `#today` for daily summaries',
        '- `#reminders` for reminder delivery',
        '- `#planning` for weekly/monthly views',
      ].join('\n'),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (interaction.commandName === 'today') {
    const review = await dependencies.todayReviewService.getReview();

    await interaction.reply({
      embeds: buildTodayEmbeds(dependencies.config, review),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (interaction.commandName === 'week') {
    const review = await dependencies.todayReviewService.getWeekReview();
    await interaction.reply({
      embeds: buildPeriodEmbeds('Week', 'Next 7 days', dependencies.config.timezone, review),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (interaction.commandName === 'month') {
    const review = await dependencies.todayReviewService.getMonthReview();
    await interaction.reply({
      embeds: buildPeriodEmbeds('Month', 'Next 31 days', dependencies.config.timezone, review),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (interaction.commandName === 'task') {
    const subcommand = interaction.options.getSubcommand(true);

    if (subcommand === 'add') {
      const content = interaction.options.getString('content', true);
      const result = await dependencies.taskService.addTask(content);

      await interaction.reply({
        embeds: [buildTaskAddSuccessEmbed(result.task)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (subcommand === 'done') {
      const task = interaction.options.getString('task', true);
      const result = await dependencies.taskService.completeTask(task);

      if (result.status === 'completed') {
        await interaction.reply({
          embeds: [buildTaskDoneSuccessEmbed(result.task)],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await interaction.reply({
        content: buildTaskResolutionMessage(result.resolution, result.status),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
  }

  if (!interaction.replied && !interaction.deferred) {
    await interaction.reply({
      content: `Unknown command: ${interaction.commandName}`,
      flags: MessageFlags.Ephemeral,
    });
  }
}

export async function handleAutocompleteInteraction(
  interaction: AutocompleteInteraction,
  dependencies: CommandDependencies,
): Promise<void> {
  if (interaction.commandName !== 'task') {
    await interaction.respond([]);
    return;
  }

  const subcommand = interaction.options.getSubcommand(false);
  const focused = interaction.options.getFocused(true);

  if (subcommand !== 'done' || focused.name !== 'task') {
    await interaction.respond([]);
    return;
  }

  const suggestions = await dependencies.taskService.getTaskDoneAutocompleteSuggestions(
    String(focused.value ?? ''),
  );

  await interaction.respond(suggestions);
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

function escapeMarkdown(value: string): string {
  return value.replaceAll('[', '\\[').replaceAll(']', '\\]');
}

function buildPeriodEmbeds(
  title: string,
  windowLabel: string,
  timezone: string,
  review: PeriodReviewResult,
) {
  const header = new EmbedBuilder()
    .setTitle(title)
    .setDescription(`${windowLabel} · Timezone: ${timezone}`)
    .addFields(
      buildTaskField('Overdue', review.overdueTasks),
      buildStatusField('Provider Status', review.todoistStatus.message, review.googleCalendarStatus.message),
    )
    .setTimestamp(new Date());

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
        .setTimestamp(new Date()),
    );
  }

  return embeds;
}

function renderDayGroup(
  label: string,
  tasks: DailyTaskSummary[],
  events: DailyEventSummary[],
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
