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
    .setDescription('Create or complete Todoist tasks.')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('add')
        .setDescription('Create a new Todoist task using Todoist quick add.')
        .addStringOption((option) =>
          option
            .setName('content')
            .setDescription('Task content, including optional Todoist quick add syntax.')
            .setRequired(true),
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
    ),
];

export const slashCommandPayload = slashCommands.map((command) => command.toJSON());
