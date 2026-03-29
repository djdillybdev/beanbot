import { SlashCommandBuilder } from 'discord.js';

export const slashCommands = [
  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check whether the bot is alive and responding.'),
  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show the current command surface and channel conventions.'),
  new SlashCommandBuilder()
    .setName('today')
    .setDescription('Show today’s overdue tasks, due tasks, and calendar events.'),
  new SlashCommandBuilder()
    .setName('week')
    .setDescription('Show overdue work and the next 7 days of tasks and calendar events.'),
  new SlashCommandBuilder()
    .setName('month')
    .setDescription('Show overdue work and the next 31 days of tasks and calendar events.'),
  new SlashCommandBuilder()
    .setName('task')
    .setDescription('Create, update, complete, reopen, or delete Todoist tasks.')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('add')
        .setDescription('Create a new Todoist task with explicit options.')
        .addStringOption((option) =>
          option
            .setName('content')
            .setDescription('Task content.')
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName('due')
            .setDescription('Due date or time, for example "tomorrow 8am" or "2026-04-05".'),
        )
        .addIntegerOption((option) =>
          option
            .setName('priority')
            .setDescription('Priority from 1 to 4, where 1 is highest urgency in Todoist.')
            .addChoices(
              { name: 'Priority 1', value: 1 },
              { name: 'Priority 2', value: 2 },
              { name: 'Priority 3', value: 3 },
              { name: 'Priority 4', value: 4 },
            ),
        )
        .addStringOption((option) =>
          option
            .setName('project')
            .setDescription('Choose a Todoist project.')
            .setAutocomplete(true),
        )
        .addStringOption((option) =>
          option
            .setName('labels')
            .setDescription('Comma-separated label names, for example "finance, monthly".'),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('done')
        .setDescription('Complete a recently seen Todoist task.')
        .addStringOption((option) =>
          option
            .setName('task')
            .setDescription('Choose a recent task from suggestions or type an exact recent title.')
            .setAutocomplete(true)
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('edit')
        .setDescription('Edit a recently seen active Todoist task.')
        .addStringOption((option) =>
          option
            .setName('task')
            .setDescription('Choose a recent active task from suggestions.')
            .setAutocomplete(true)
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('delete')
        .setDescription('Delete a recently seen active Todoist task.')
        .addStringOption((option) =>
          option
            .setName('task')
            .setDescription('Choose a recent active task from suggestions.')
            .setAutocomplete(true)
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('reopen')
        .setDescription('Reopen a recently completed Todoist task.')
        .addStringOption((option) =>
          option
            .setName('task')
            .setDescription('Choose a recent completed task from suggestions.')
            .setAutocomplete(true)
            .setRequired(true),
        ),
    ),
];

export const slashCommandPayload = slashCommands.map((command) => command.toJSON());
