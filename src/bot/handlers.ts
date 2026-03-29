import {
  ActionRowBuilder,
  type AutocompleteInteraction,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

import { TodayReviewService } from '../app/today/get-today-review';
import { TaskService } from '../app/tasks/task-service';
import { buildTodayEmbeds } from './renderers/today';
import type { AppConfig } from '../config';
import type { DailyEventSummary, DailyTaskSummary, PeriodReviewResult } from '../domain/daily-review';
import {
  buildTaskAddSuccessEmbed,
  buildTaskDeleteSuccessEmbed,
  buildTaskDoneSuccessEmbed,
  buildTaskEditSuccessEmbed,
  buildTaskReopenSuccessEmbed,
  buildTaskResolutionMessage,
} from './renderers/task';

const TASK_EDIT_MODAL_PREFIX = 'task-edit:';

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
        '`/task done` completes a recently seen active task.',
        '`/task edit` opens a prefilled edit modal for a recent active task.',
        '`/task delete` deletes a recent active task.',
        '`/task reopen` reopens a recently completed task.',
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
      const due = interaction.options.getString('due') ?? undefined;
      const priority = interaction.options.getInteger('priority') ?? undefined;
      const projectValue = interaction.options.getString('project') ?? undefined;
      const labelsRaw = interaction.options.getString('labels') ?? undefined;
      const labels = parseLabels(labelsRaw);

      let projectId: string | undefined;

      if (projectValue) {
        const project = await dependencies.taskService.validateProjectSelection(projectValue);

        if (!project) {
          await interaction.reply({
            content: 'Select a project from the autocomplete suggestions so the bot can map it to Todoist safely.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        projectId = project.id;
      }

      const result = await dependencies.taskService.addTask({
        content,
        due,
        priority: toPriority(priority),
        projectId,
        labels,
      });

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

    if (subcommand === 'edit') {
      const taskId = interaction.options.getString('task', true);
      const task = await dependencies.taskService.getTaskForEdit(taskId);

      if (!task) {
        await interaction.reply({
          content: 'Select a recent active task from autocomplete before opening the edit modal.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await interaction.showModal(buildTaskEditModal(task.id, task));
      return;
    }

    if (subcommand === 'delete') {
      const taskId = interaction.options.getString('task', true);
      const task = await withTaskCommandError(interaction, () => dependencies.taskService.deleteTask(taskId));

      if (!task) {
        return;
      }

      await interaction.reply({
        embeds: [buildTaskDeleteSuccessEmbed(task)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (subcommand === 'reopen') {
      const taskId = interaction.options.getString('task', true);
      const task = await withTaskCommandError(interaction, () => dependencies.taskService.reopenTask(taskId));

      if (!task) {
        return;
      }

      await interaction.reply({
        embeds: [buildTaskReopenSuccessEmbed(task)],
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

  if (subcommand === 'add' && focused.name === 'project') {
    const suggestions = await dependencies.taskService.getProjectAutocompleteSuggestions(
      String(focused.value ?? ''),
    );
    await interaction.respond(suggestions);
    return;
  }

  if (focused.name !== 'task') {
    await interaction.respond([]);
    return;
  }

  if (subcommand === 'done' || subcommand === 'edit' || subcommand === 'delete') {
    const suggestions = await dependencies.taskService.getTaskDoneAutocompleteSuggestions(
      String(focused.value ?? ''),
    );
    await interaction.respond(suggestions);
    return;
  }

  if (subcommand === 'reopen') {
    const suggestions = await dependencies.taskService.getTaskReopenAutocompleteSuggestions(
      String(focused.value ?? ''),
    );
    await interaction.respond(suggestions);
    return;
  }

  await interaction.respond([]);
}

export async function handleModalSubmitInteraction(
  interaction: ModalSubmitInteraction,
  dependencies: CommandDependencies,
): Promise<void> {
  if (!interaction.customId.startsWith(TASK_EDIT_MODAL_PREFIX)) {
    return;
  }

  const taskId = interaction.customId.slice(TASK_EDIT_MODAL_PREFIX.length);
  const content = interaction.fields.getTextInputValue('content');
  const dueString = interaction.fields.getTextInputValue('due');
  const priorityRaw = interaction.fields.getTextInputValue('priority').trim();
  const projectName = interaction.fields.getTextInputValue('project');
  const labelsRaw = interaction.fields.getTextInputValue('labels');
  const priority = parsePriority(priorityRaw);

  if (priorityRaw.length > 0 && !priority) {
    await interaction.reply({
      content: 'Priority must be 1, 2, 3, or 4.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const task = await withTaskCommandError(interaction, () =>
    dependencies.taskService.editTask(taskId, {
    content,
    dueString,
    priority,
    projectName,
    labels: parseLabels(labelsRaw) ?? [],
    }),
  );

  if (!task) {
    return;
  }

  await interaction.reply({
    embeds: [buildTaskEditSuccessEmbed(task)],
    flags: MessageFlags.Ephemeral,
  });
}

function toPriority(value: number | null | undefined): 1 | 2 | 3 | 4 | undefined {
  if (value === 1 || value === 2 || value === 3 || value === 4) {
    return value;
  }

  return undefined;
}

function parsePriority(value: string): 1 | 2 | 3 | 4 | undefined {
  return toPriority(Number(value));
}

function parseLabels(labelsRaw: string | null | undefined) {
  return labelsRaw
    ? labelsRaw
        .split(',')
        .map((label) => label.trim())
        .filter((label) => label.length > 0)
    : undefined;
}

function buildTaskEditModal(taskId: string, task: {
  title: string;
  dueString?: string;
  priority: number;
  projectName?: string;
  labels?: string[];
}) {
  return new ModalBuilder()
    .setCustomId(`${TASK_EDIT_MODAL_PREFIX}${taskId}`)
    .setTitle('Edit Task')
    .addComponents(
      buildModalRow(
        new TextInputBuilder()
          .setCustomId('content')
          .setLabel('Title')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(task.title),
      ),
      buildModalRow(
        setOptionalValue(
          new TextInputBuilder()
          .setCustomId('due')
          .setLabel('Due')
          .setStyle(TextInputStyle.Short)
          .setRequired(false),
          task.dueString,
        ),
      ),
      buildModalRow(
        setOptionalValue(
          new TextInputBuilder()
          .setCustomId('priority')
          .setLabel('Priority (1-4, blank resets to 1)')
          .setStyle(TextInputStyle.Short)
          .setRequired(false),
          String(task.priority),
        ),
      ),
      buildModalRow(
        setOptionalValue(
          new TextInputBuilder()
          .setCustomId('project')
          .setLabel('Project (exact name, blank = Inbox)')
          .setStyle(TextInputStyle.Short)
          .setRequired(false),
          task.projectName,
        ),
      ),
      buildModalRow(
        setOptionalValue(
          new TextInputBuilder()
          .setCustomId('labels')
          .setLabel('Labels (comma-separated, blank clears)')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false),
          task.labels?.join(', '),
        ),
      ),
    );
}

function buildModalRow(input: TextInputBuilder) {
  return new ActionRowBuilder<TextInputBuilder>().addComponents(input);
}

function setOptionalValue(input: TextInputBuilder, value?: string) {
  if (value && value.length > 0) {
    input.setValue(value);
  }

  return input;
}

async function withTaskCommandError<T>(
  interaction: ChatInputCommandInteraction | ModalSubmitInteraction,
  action: () => Promise<T>,
) {
  try {
    return await action();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Task command failed.';

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral });
    } else {
      await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
    }

    return null;
  }
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
