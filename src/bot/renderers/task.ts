import { EmbedBuilder } from 'discord.js';

import type { TaskCompletionResolution, TodoistTaskRecord } from '../../domain/task';

export function buildTaskAddSuccessEmbed(task: TodoistTaskRecord) {
  return new EmbedBuilder()
    .setTitle('Task Created')
    .setDescription(`[${escapeMarkdown(task.title)}](${task.url})`)
    .addFields(
      {
        name: 'Due',
        value: task.dueLabel ?? 'No due date',
        inline: false,
      },
      {
        name: 'Priority',
        value: String(task.priority),
        inline: true,
      },
    )
    .setTimestamp(new Date());
}

export function buildTaskDoneSuccessEmbed(task: TodoistTaskRecord) {
  return new EmbedBuilder()
    .setTitle('Task Completed')
    .setDescription(`[${escapeMarkdown(task.title)}](${task.url})`)
    .addFields({
      name: 'Status',
      value: 'Marked complete in Todoist.',
      inline: false,
    })
    .setTimestamp(new Date());
}

export function buildTaskResolutionMessage(
  resolution: TaskCompletionResolution,
  kind: 'no_match' | 'ambiguous',
) {
  if (kind === 'no_match') {
    return [
      `No recent task matched "${resolution.query}".`,
      'Run `/today`, `/week`, or `/month` first so the task is cached locally, then try again.',
    ].join('\n');
  }

  return [
    `Multiple recent tasks matched "${resolution.query}".`,
    ...resolution.matches.map((task) => `- ${task.title}${task.dueLabel ? ` · ${task.dueLabel}` : ''}`),
  ].join('\n');
}

function escapeMarkdown(value: string) {
  return value.replaceAll('[', '\\[').replaceAll(']', '\\]');
}
