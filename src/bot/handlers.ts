import {
  ActionRowBuilder,
  type AutocompleteInteraction,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  type Message,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  StringSelectMenuBuilder,
  type StringSelectMenuInteraction,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

import { EventDraftStore, type EventDraft } from './event-draft-store';
import { TodayReviewService } from '../app/today/get-today-review';
import { EventService } from '../app/events/event-service';
import { TaskService } from '../app/tasks/task-service';
import { buildHabitsEmbeds, buildMonthEmbeds, buildTodayEmbeds, buildUndatedEmbeds, buildWeekEmbeds } from './renderers/today';
import type { AppConfig } from '../config';
import type { GoogleCalendarEventRecord } from '../domain/event';
import { formatLocalDateTimeInput, formatLocalDayLabel, getDateKeysInRange, parseLocalDateTimeInput } from '../utils/time';
import {
  buildEventAddSuccessEmbed,
  buildEventDeleteSuccessEmbed,
  buildEventEditSuccessEmbed,
} from './renderers/event';
import {
  buildTaskAddSuccessEmbed,
  buildTaskDeleteSuccessEmbed,
  buildTaskDoneSuccessEmbed,
  buildTaskEditSuccessEmbed,
  buildTaskReopenSuccessEmbed,
  buildTaskResolutionMessage,
} from './renderers/task';
import type { Logger } from '../logging/logger';

const TASK_EDIT_MODAL_PREFIX = 'task-edit:';
const EVENT_ADD_DETAILS_MODAL_PREFIX = 'event-add-details:';
const EVENT_EDIT_DETAILS_MODAL_PREFIX = 'event-edit-details:';
const EVENT_CUSTOM_TIME_MODAL_PREFIX = 'event-custom-time:';
const EVENT_PICKER_DATE_PREFIX = 'event-picker:date:';
const EVENT_PICKER_HOUR_PREFIX = 'event-picker:hour:';
const EVENT_PICKER_MINUTE_PREFIX = 'event-picker:minute:';
const EVENT_PICKER_DURATION_PREFIX = 'event-picker:duration:';
const EVENT_PICKER_SAVE_PREFIX = 'event-picker:save:';
const EVENT_PICKER_CUSTOM_PREFIX = 'event-picker:custom:';
const EVENT_PICKER_CANCEL_PREFIX = 'event-picker:cancel:';
const EVENT_CUSTOM_FALLBACK_VALUE = '__custom__';
const QUICK_PICKER_DURATION_MINUTES = [15, 30, 45, 60, 90, 120, 180, 240] as const;
const QUICK_PICKER_MINUTES = ['00', '15', '30', '45'] as const;
const QUICK_PICKER_DAYS = 14;

export interface CommandDependencies {
  config: AppConfig;
  todayReviewService: TodayReviewService;
  taskService: TaskService;
  eventService: EventService;
  eventDraftStore: EventDraftStore;
  logger: Logger;
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
        '`/habits` shows today’s habit tasks, completions, and streaks.',
        '`/undated` shows active non-habit tasks with no due date.',
        '`/task add` creates a Todoist task.',
        '`/task done` completes a recently seen active task.',
        '`/task edit` opens a prefilled edit modal for a recent active task.',
        '`/task delete` deletes a recent active task.',
        '`/task reopen` reopens a recently completed task.',
        '`/event add` opens a guided event creation flow.',
        '`/event edit` opens a guided edit flow for a recent event.',
        '`/event delete` deletes a recent event.',
        '',
        'Inbox capture:',
        '- Every non-bot message in `#inbox` is treated as a new Todoist task via quick add.',
        '- Successful captures get a reaction. The bot replies only if capture fails.',
        '',
        'Connect providers:',
        `- Todoist: ${dependencies.config.publicBaseUrl}/auth/todoist/start`,
        `- Google Calendar: ${dependencies.config.publicBaseUrl}/auth/google/start`,
        '',
        'Intended channel layout:',
        '- `#inbox` for task capture and command entry',
        '- `#today` for daily summaries and `/today`',
        '- `#week` for the live weekly status and `/week`',
        '- `#month` for the live monthly status and `/month`',
        '- `#habits` for the live habit status and `/habits`',
        '- `#inbox` also keeps a pinned undated-task view for `/undated`',
        '- `#upcoming` for a rolling next-14-days task view',
        '- `#reminders` for reminder delivery',
        '- `#logs` for runtime diagnostics and failures',
      ].join('\n'),
      flags: shouldUseEphemeralReply(interaction, dependencies.config, 'help')
        ? MessageFlags.Ephemeral
        : undefined,
    });
    return;
  }

  if (interaction.commandName === 'today') {
    const review = await dependencies.todayReviewService.getReview();

    await interaction.reply({
      embeds: buildTodayEmbeds(dependencies.config, review),
      flags: shouldUseEphemeralReply(interaction, dependencies.config, 'today')
        ? MessageFlags.Ephemeral
        : undefined,
    });
    return;
  }

  if (interaction.commandName === 'week') {
    const review = await dependencies.todayReviewService.getWeekReview();
    await interaction.reply({
      embeds: buildWeekEmbeds(dependencies.config, review),
      flags: shouldUseEphemeralReply(interaction, dependencies.config, 'week')
        ? MessageFlags.Ephemeral
        : undefined,
    });
    return;
  }

  if (interaction.commandName === 'month') {
    const review = await dependencies.todayReviewService.getMonthReview();
    await interaction.reply({
      embeds: buildMonthEmbeds(dependencies.config, review),
      flags: shouldUseEphemeralReply(interaction, dependencies.config, 'month')
        ? MessageFlags.Ephemeral
        : undefined,
    });
    return;
  }

  if (interaction.commandName === 'habits') {
    const review = await dependencies.todayReviewService.getHabitReview();
    await interaction.reply({
      embeds: buildHabitsEmbeds(dependencies.config, review),
      flags: shouldUseEphemeralReply(interaction, dependencies.config, 'habits')
        ? MessageFlags.Ephemeral
        : undefined,
    });
    return;
  }

  if (interaction.commandName === 'undated') {
    const review = await dependencies.todayReviewService.getUndatedTaskReview();
    await interaction.reply({
      embeds: buildUndatedEmbeds(dependencies.config, review),
      flags: shouldUseEphemeralReply(interaction, dependencies.config, 'undated')
        ? MessageFlags.Ephemeral
        : undefined,
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
      dependencies.logger.warn('Task completion did not resolve to a single task', {
        status: result.status,
        query: task,
        matchCount: result.resolution.matches.length,
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
      const task = await withTaskCommandError(interaction, dependencies.logger, () =>
        dependencies.taskService.deleteTask(taskId),
      );

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
      const task = await withTaskCommandError(interaction, dependencies.logger, () =>
        dependencies.taskService.reopenTask(taskId),
      );

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

  if (interaction.commandName === 'event') {
    const subcommand = interaction.options.getSubcommand(true);

    if (subcommand === 'add') {
      const draft = dependencies.eventDraftStore.createForAdd(getDefaultAddDraft(dependencies.config.timezone));
      await interaction.showModal(buildEventDetailsModal('Create Event', `${EVENT_ADD_DETAILS_MODAL_PREFIX}${draft.id}`, draft));
      return;
    }

    if (subcommand === 'edit') {
      const eventId = interaction.options.getString('event', true);
      const event = await dependencies.eventService.getEventForEdit(eventId);

      if (!event) {
        await interaction.reply({
          content: 'Select a recent one-off event from autocomplete before opening the edit modal.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const draft = dependencies.eventDraftStore.createForEdit(
        event,
        dependencies.config.timezone,
        getEditDraftSelections(event, dependencies.config.timezone),
      );
      await interaction.showModal(buildEventDetailsModal('Edit Event', `${EVENT_EDIT_DETAILS_MODAL_PREFIX}${draft.id}`, draft));
      return;
    }

    if (subcommand === 'delete') {
      const eventId = interaction.options.getString('event', true);
      const event = await withEventCommandError(interaction, dependencies.logger, () =>
        dependencies.eventService.deleteEvent(eventId),
      );

      if (!event) {
        return;
      }

      await interaction.reply({
        embeds: [buildEventDeleteSuccessEmbed(event)],
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

export async function handleInboxMessage(
  message: Message,
  dependencies: CommandDependencies,
): Promise<void> {
  if (!message.inGuild()) {
    return;
  }

  if (message.author.bot || message.system || message.webhookId) {
    return;
  }

  if (message.channelId !== dependencies.config.inboxChannelId) {
    return;
  }

  await dependencies.taskService.addInboxTask(message.content);
  await message.react('✅');
}

export async function handleAutocompleteInteraction(
  interaction: AutocompleteInteraction,
  dependencies: CommandDependencies,
): Promise<void> {
  if (interaction.commandName === 'event') {
    const focused = interaction.options.getFocused(true);

    if (focused.name === 'event') {
      const suggestions = await dependencies.eventService.getEventAutocompleteSuggestions(
        String(focused.value ?? ''),
      );
      await interaction.respond(suggestions);
      return;
    }

    await interaction.respond([]);
    return;
  }

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

export async function handleMessageComponentInteraction(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  dependencies: CommandDependencies,
): Promise<void> {
  const { customId } = interaction;

  if (interaction.isStringSelectMenu()) {
    const value = interaction.values[0];

    if (customId.startsWith(EVENT_PICKER_DATE_PREFIX)) {
      const draft = dependencies.eventDraftStore.update(
        customId.slice(EVENT_PICKER_DATE_PREFIX.length),
        { selectedDate: value === EVENT_CUSTOM_FALLBACK_VALUE ? undefined : value },
      );
      await updateDraftPicker(interaction, dependencies, draft, value === EVENT_CUSTOM_FALLBACK_VALUE
        ? 'Use `Custom Time…` for dates outside the next 14 days.'
        : undefined);
      return;
    }

    if (customId.startsWith(EVENT_PICKER_HOUR_PREFIX)) {
      const draft = dependencies.eventDraftStore.update(
        customId.slice(EVENT_PICKER_HOUR_PREFIX.length),
        { selectedHour: value },
      );
      await updateDraftPicker(interaction, dependencies, draft);
      return;
    }

    if (customId.startsWith(EVENT_PICKER_MINUTE_PREFIX)) {
      const draft = dependencies.eventDraftStore.update(
        customId.slice(EVENT_PICKER_MINUTE_PREFIX.length),
        { selectedMinute: value },
      );
      await updateDraftPicker(interaction, dependencies, draft);
      return;
    }

    if (customId.startsWith(EVENT_PICKER_DURATION_PREFIX)) {
      const draft = dependencies.eventDraftStore.update(
        customId.slice(EVENT_PICKER_DURATION_PREFIX.length),
        { selectedDurationMinutes: Number(value) },
      );
      await updateDraftPicker(interaction, dependencies, draft);
      return;
    }

    return;
  }

  if (customId.startsWith(EVENT_PICKER_CANCEL_PREFIX)) {
    const draftId = customId.slice(EVENT_PICKER_CANCEL_PREFIX.length);
    dependencies.eventDraftStore.delete(draftId);
    await interaction.update({
      content: 'Event draft cancelled.',
      components: [],
      embeds: [],
    });
    return;
  }

  if (customId.startsWith(EVENT_PICKER_CUSTOM_PREFIX)) {
    const draftId = customId.slice(EVENT_PICKER_CUSTOM_PREFIX.length);
    const draft = dependencies.eventDraftStore.get(draftId);

    if (!draft) {
      await interaction.reply({
        content: 'That event draft expired. Run `/event add` or `/event edit` again.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.showModal(
      buildEventCustomTimeModal(
        dependencies.config.timezone,
        `${EVENT_CUSTOM_TIME_MODAL_PREFIX}${draft.id}`,
        draft,
        dependencies.eventDraftStore,
      ),
    );
    return;
  }

  if (customId.startsWith(EVENT_PICKER_SAVE_PREFIX)) {
    const draftId = customId.slice(EVENT_PICKER_SAVE_PREFIX.length);
    const draft = dependencies.eventDraftStore.get(draftId);

    if (!draft) {
      await interaction.reply({
        content: 'That event draft expired. Run `/event add` or `/event edit` again.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!hasCompletePickerSelection(draft)) {
      await interaction.reply({
        content: 'Choose a date, start time, and duration, or use `Custom Time…`.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const start = buildPickerStartInput(draft);
    const end = buildPickerEndInput(draft, dependencies.config.timezone);
    const event = await runEventDraftMutation(interaction, dependencies, draft, start, end);

    if (!event) {
      return;
    }

    dependencies.eventDraftStore.delete(draftId);
    await interaction.update({
      content: '',
      embeds: [draft.mode === 'add' ? buildEventAddSuccessEmbed(event) : buildEventEditSuccessEmbed(event)],
      components: [],
    });
  }
}

export async function handleModalSubmitInteraction(
  interaction: ModalSubmitInteraction,
  dependencies: CommandDependencies,
): Promise<void> {
  if (interaction.customId.startsWith(EVENT_ADD_DETAILS_MODAL_PREFIX)) {
    const draftId = interaction.customId.slice(EVENT_ADD_DETAILS_MODAL_PREFIX.length);
    const draft = dependencies.eventDraftStore.update(draftId, readEventDetailsModal(interaction));

    if (!draft) {
      await interaction.reply({
        content: 'That event draft expired. Run `/event add` again.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.reply({
      ...buildDraftPickerMessage(dependencies.config.timezone, draft),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (interaction.customId.startsWith(EVENT_EDIT_DETAILS_MODAL_PREFIX)) {
    const draftId = interaction.customId.slice(EVENT_EDIT_DETAILS_MODAL_PREFIX.length);
    const draft = dependencies.eventDraftStore.update(draftId, readEventDetailsModal(interaction));

    if (!draft) {
      await interaction.reply({
        content: 'That event draft expired. Run `/event edit` again.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.reply({
      ...buildDraftPickerMessage(dependencies.config.timezone, draft),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (interaction.customId.startsWith(EVENT_CUSTOM_TIME_MODAL_PREFIX)) {
    const draftId = interaction.customId.slice(EVENT_CUSTOM_TIME_MODAL_PREFIX.length);
    const draft = dependencies.eventDraftStore.get(draftId);

    if (!draft) {
      await interaction.reply({
        content: 'That event draft expired. Run `/event add` or `/event edit` again.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const start = interaction.fields.getTextInputValue('start');
    const end = interaction.fields.getTextInputValue('end');
    const event = await runEventDraftMutation(interaction, dependencies, draft, start, end);

    if (!event) {
      return;
    }

    dependencies.eventDraftStore.delete(draft.id);
    await interaction.reply({
      embeds: [draft.mode === 'add' ? buildEventAddSuccessEmbed(event) : buildEventEditSuccessEmbed(event)],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

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

  const task = await withTaskCommandError(interaction, dependencies.logger, () =>
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

function shouldUseEphemeralReply(
  interaction: ChatInputCommandInteraction,
  config: AppConfig,
  commandName: 'help' | 'today' | 'week' | 'month' | 'habits' | 'undated',
) {
  if (commandName === 'today') {
    return interaction.channelId !== config.todayChannelId;
  }

  if (commandName === 'week' || commandName === 'month' || commandName === 'habits') {
    return interaction.channelId !== (
      commandName === 'week'
        ? config.weekChannelId
        : commandName === 'month'
          ? config.monthChannelId
          : config.habitsChannelId
    );
  }

  if (commandName === 'undated') {
    return interaction.channelId !== config.inboxChannelId;
  }

  return interaction.channelId !== config.inboxChannelId;
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

function buildEventDetailsModal(title: string, customId: string, draft: {
  title: string;
  location?: string;
  description?: string;
}) {
  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(title)
    .addComponents(
      buildModalRow(
        new TextInputBuilder()
          .setCustomId('title')
          .setLabel('Title')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(draft.title),
      ),
      buildModalRow(
        setOptionalValue(
          new TextInputBuilder()
            .setCustomId('location')
            .setLabel('Location')
            .setStyle(TextInputStyle.Short)
            .setRequired(false),
          draft.location,
        ),
      ),
      buildModalRow(
        setOptionalValue(
          new TextInputBuilder()
            .setCustomId('description')
            .setLabel('Description')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false),
          draft.description,
        ),
      ),
    );
}

function buildEventCustomTimeModal(
  timezone: string,
  customId: string,
  draft: EventDraft,
  draftStore: EventDraftStore,
) {
  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle('Custom Event Time')
    .addComponents(
      buildModalRow(
        setOptionalValue(
          new TextInputBuilder()
            .setCustomId('start')
            .setLabel(`Start (${timezone})`)
            .setStyle(TextInputStyle.Short)
            .setRequired(true),
          draftStore.getCurrentStartInput(draft, timezone),
        ),
      ),
      buildModalRow(
        setOptionalValue(
          new TextInputBuilder()
            .setCustomId('end')
            .setLabel(`End (${timezone})`)
            .setStyle(TextInputStyle.Short)
            .setRequired(true),
          draftStore.getCurrentEndInput(draft, timezone),
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
  logger: Logger,
  action: () => Promise<T>,
) {
  try {
    return await action();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Task command failed.';
    logger.error('Task command failed', error, {
      customId: interaction.isModalSubmit() ? interaction.customId : undefined,
      commandName: interaction.isChatInputCommand() ? interaction.commandName : undefined,
      channelId: interaction.channelId ?? undefined,
    });

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral });
    } else {
      await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
    }

    return null;
  }
}

async function withEventCommandError<T>(
  interaction: ChatInputCommandInteraction | ModalSubmitInteraction,
  logger: Logger,
  action: () => Promise<T>,
) {
  try {
    return await action();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Event command failed.';
    logger.error('Event command failed', error, {
      customId: interaction.isModalSubmit() ? interaction.customId : undefined,
      commandName: interaction.isChatInputCommand() ? interaction.commandName : undefined,
      channelId: interaction.channelId ?? undefined,
    });

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral });
    } else {
      await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
    }

    return null;
  }
}

function getDefaultAddDraft(timezone: string) {
  const roundedStart = getDefaultRoundedStart(timezone);
  const { date, hour, minute } = splitLocalDateTime(formatLocalDateTimeInput(roundedStart, timezone));

  return {
    selectedDate: date,
    selectedHour: hour,
    selectedMinute: minute,
    selectedDurationMinutes: 60,
  };
}

function getEditDraftSelections(event: GoogleCalendarEventRecord, timezone: string) {
  const { date, hour, minute } = splitLocalDateTime(
    formatLocalDateTimeInput(new Date(event.startUtc), timezone),
  );
  const availableDates = new Set(getDateKeysInRange(getTodayDateKey(timezone), QUICK_PICKER_DAYS));
  const durationMinutes = Math.round((Date.parse(event.endUtc) - Date.parse(event.startUtc)) / 60_000);

  return {
    selectedDate: availableDates.has(date) ? date : undefined,
    selectedHour: hour,
    selectedMinute: QUICK_PICKER_MINUTES.includes(minute as (typeof QUICK_PICKER_MINUTES)[number])
      ? minute
      : undefined,
    selectedDurationMinutes: QUICK_PICKER_DURATION_MINUTES.includes(
      durationMinutes as (typeof QUICK_PICKER_DURATION_MINUTES)[number],
    )
      ? durationMinutes
      : undefined,
  };
}

function buildDraftPickerMessage(timezone: string, draft: EventDraft, notice?: string) {
  const info = [
    `Event: ${draft.title || 'Untitled event'}`,
    `Timezone: ${timezone}`,
  ];

  if (!hasCompletePickerSelection(draft) && draft.mode === 'edit') {
    info.push('Current event time is outside the quick picker. Choose new values or use `Custom Time…`.');
  }

  if (notice) {
    info.push(notice);
  }

  return {
    content: info.join('\n'),
    components: buildDraftPickerComponents(timezone, draft),
  };
}

function buildDraftPickerComponents(timezone: string, draft: EventDraft) {
  const todayDateKey = getTodayDateKey(timezone);
  const dateOptions = getDateKeysInRange(todayDateKey, QUICK_PICKER_DAYS).map((dateKey) => ({
    label: formatLocalDayLabel(dateKey, timezone),
    value: dateKey,
    default: draft.selectedDate === dateKey,
  }));

  dateOptions.push({
    label: 'Custom…',
    value: EVENT_CUSTOM_FALLBACK_VALUE,
    default: false,
  });

  const hourOptions = Array.from({ length: 24 }, (_, hour) => {
    const value = String(hour).padStart(2, '0');
    return {
      label: value,
      value,
      default: draft.selectedHour === value,
    };
  });

  const minuteOptions = QUICK_PICKER_MINUTES.map((value) => ({
    label: value,
    value,
    default: draft.selectedMinute === value,
  }));

  const durationOptions = QUICK_PICKER_DURATION_MINUTES.map((value) => ({
    label: formatDuration(value),
    value: String(value),
    default: draft.selectedDurationMinutes === value,
  }));

  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`${EVENT_PICKER_DATE_PREFIX}${draft.id}`)
        .setPlaceholder(draft.selectedDate ?? 'Choose a date')
        .addOptions(dateOptions),
    ),
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`${EVENT_PICKER_HOUR_PREFIX}${draft.id}`)
        .setPlaceholder(draft.selectedHour ?? 'Start hour')
        .addOptions(hourOptions),
    ),
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`${EVENT_PICKER_MINUTE_PREFIX}${draft.id}`)
        .setPlaceholder(draft.selectedMinute ?? 'Start minute')
        .addOptions(minuteOptions),
    ),
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`${EVENT_PICKER_DURATION_PREFIX}${draft.id}`)
        .setPlaceholder(
          draft.selectedDurationMinutes ? formatDuration(draft.selectedDurationMinutes) : 'Duration',
        )
        .addOptions(durationOptions),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${EVENT_PICKER_SAVE_PREFIX}${draft.id}`)
        .setLabel(draft.mode === 'add' ? 'Create Event' : 'Save Event')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`${EVENT_PICKER_CUSTOM_PREFIX}${draft.id}`)
        .setLabel('Custom Time…')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`${EVENT_PICKER_CANCEL_PREFIX}${draft.id}`)
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Danger),
    ),
  ];
}

function readEventDetailsModal(interaction: ModalSubmitInteraction) {
  return {
    title: interaction.fields.getTextInputValue('title'),
    location: interaction.fields.getTextInputValue('location'),
    description: interaction.fields.getTextInputValue('description'),
  };
}

async function updateDraftPicker(
  interaction: StringSelectMenuInteraction,
  dependencies: CommandDependencies,
  draft: EventDraft | null,
  notice?: string,
) {
  if (!draft) {
    await interaction.update({
      content: 'That event draft expired. Run `/event add` or `/event edit` again.',
      components: [],
      embeds: [],
    });
    return;
  }

  await interaction.update(buildDraftPickerMessage(dependencies.config.timezone, draft, notice));
}

async function runEventDraftMutation(
  interaction: ButtonInteraction | ModalSubmitInteraction,
  dependencies: CommandDependencies,
  draft: EventDraft,
  start: string,
  end: string,
) {
  if (draft.mode === 'add') {
    return withEventDraftError(interaction, () =>
      dependencies.eventService.addEvent({
        title: draft.title,
        start,
        end,
        location: emptyStringToUndefined(draft.location),
        description: emptyStringToUndefined(draft.description),
      }),
    );
  }

  if (!draft.eventId) {
    await respondToComponentError(interaction, 'That event draft is missing its target event id.');
    return null;
  }

  return withEventDraftError(interaction, () =>
    dependencies.eventService.editEvent(draft.eventId!, {
      title: draft.title,
      start,
      end,
      location: draft.location ?? '',
      description: draft.description ?? '',
    }),
  );
}

async function withEventDraftError<T>(
  interaction: ButtonInteraction | ModalSubmitInteraction,
  action: () => Promise<T>,
) {
  try {
    return await action();
  } catch (error) {
    await respondToComponentError(interaction, error instanceof Error ? error.message : 'Event command failed.');
    return null;
  }
}

async function respondToComponentError(
  interaction: ButtonInteraction | ModalSubmitInteraction,
  message: string,
) {
  if (interaction.replied || interaction.deferred) {
    await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral });
  } else {
    await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
  }
}

function emptyStringToUndefined(value?: string) {
  return value && value.trim().length > 0 ? value : undefined;
}

function hasCompletePickerSelection(draft: EventDraft) {
  return Boolean(
    draft.selectedDate &&
      draft.selectedHour &&
      draft.selectedMinute &&
      draft.selectedDurationMinutes,
  );
}

function buildPickerStartInput(draft: EventDraft) {
  return `${draft.selectedDate!} ${draft.selectedHour!}:${draft.selectedMinute!}`;
}

function buildPickerEndInput(draft: EventDraft, timezone: string) {
  const start = parseLocalDateTimeInput(buildPickerStartInput(draft), timezone);
  const end = new Date(start.getTime() + draft.selectedDurationMinutes! * 60_000);
  return formatLocalDateTimeInput(end, timezone);
}

function getDefaultRoundedStart(timezone: string) {
  const now = parseLocalDateTimeInput(formatLocalDateTimeInput(new Date(), timezone), timezone);
  now.setUTCSeconds(0, 0);
  const remainder = now.getUTCMinutes() % 15;
  now.setUTCMinutes(now.getUTCMinutes() + (remainder === 0 ? 15 : 15 - remainder));
  return now;
}

function getTodayDateKey(timezone: string) {
  return formatLocalDateTimeInput(new Date(), timezone).slice(0, 10);
}

function formatDuration(minutes: number) {
  if (minutes % 60 === 0) {
    return `${minutes / 60}h`;
  }

  if (minutes > 60) {
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return `${hours}h ${remainder}m`;
  }

  return `${minutes}m`;
}

function splitLocalDateTime(value: string) {
  const [date, time] = value.split(' ');

  if (!date || !time) {
    throw new Error(`Invalid local datetime string: ${value}`);
  }

  const [hour, minute] = time.split(':');

  if (!hour || !minute) {
    throw new Error(`Invalid local time string: ${value}`);
  }

  return { date, hour, minute };
}
