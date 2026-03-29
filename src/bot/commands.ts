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
];

export const slashCommandPayload = slashCommands.map((command) => command.toJSON());
