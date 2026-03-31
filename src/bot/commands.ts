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
    .setName('habits')
    .setDescription('Show today’s habit tasks, completions, and streaks.'),
  new SlashCommandBuilder()
    .setName('undated')
    .setDescription('Show active non-habit Todoist tasks with no due date.'),
  new SlashCommandBuilder()
    .setName('event')
    .setDescription('Create, update, or delete Google Calendar events.')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('add')
        .setDescription('Create a new timed Google Calendar event with a guided picker.'),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('edit')
        .setDescription('Edit a recently seen Google Calendar event.')
        .addStringOption((option) =>
          option
            .setName('event')
            .setDescription('Choose a recent event from suggestions.')
            .setAutocomplete(true)
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('delete')
        .setDescription('Delete a recently seen Google Calendar event.')
        .addStringOption((option) =>
          option
            .setName('event')
            .setDescription('Choose a recent event from suggestions.')
            .setAutocomplete(true)
            .setRequired(true),
        ),
    ),
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
  new SlashCommandBuilder()
    .setName('admin')
    .setDescription('Inspect runtime health and run operator recovery actions.')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('health')
        .setDescription('Show runtime health, degraded subsystems, and provider state.'),
    )
    .addSubcommandGroup((group) =>
      group
        .setName('cache')
        .setDescription('Inspect and rebuild local caches.')
        .addSubcommand((subcommand) =>
          subcommand
            .setName('inspect')
            .setDescription('Show task and event cache freshness.'),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('rebuild')
            .setDescription('Rebuild task and/or event caches from providers.')
            .addStringOption((option) =>
              option
                .setName('target')
                .setDescription('Which cache to rebuild.')
                .setRequired(true)
                .addChoices(
                  { name: 'All', value: 'all' },
                  { name: 'Tasks', value: 'tasks' },
                  { name: 'Events', value: 'events' },
                ),
            ),
        ),
    )
    .addSubcommandGroup((group) =>
      group
        .setName('reminders')
        .setDescription('Inspect and repair reminder delivery state.')
        .addSubcommand((subcommand) =>
          subcommand
            .setName('inspect')
            .setDescription('Show reminder backlog and recent failed jobs.'),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('retry-failed')
            .setDescription('Reset failed reminder jobs back to pending.'),
        ),
    )
    .addSubcommandGroup((group) =>
      group
        .setName('obsidian')
        .setDescription('Inspect and repair Obsidian sync state.')
        .addSubcommand((subcommand) =>
          subcommand
            .setName('status')
            .setDescription('Show Obsidian sync status and recent events.'),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('sync-once')
            .setDescription('Run one managed Obsidian sync pass now.'),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('conflicts')
            .setDescription('List tracked Obsidian conflicts and repair hints.'),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('resolve')
            .setDescription('Run a repair action for one tracked Obsidian task.')
            .addStringOption((option) =>
              option
                .setName('task_id')
                .setDescription('Tracked Todoist task id.')
                .setRequired(true),
            )
            .addStringOption((option) =>
              option
                .setName('action')
                .setDescription('Repair action to run.')
                .setRequired(true)
                .addChoices(
                  { name: 'Retry Push', value: 'retry-push' },
                  { name: 'Retry Delete', value: 'retry-delete' },
                  { name: 'Re-export', value: 're-export' },
                ),
            ),
        ),
    ),
];

export const slashCommandPayload = slashCommands.map((command) => command.toJSON());
