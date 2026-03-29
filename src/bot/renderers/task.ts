import { EmbedBuilder } from 'discord.js';

import type { TaskCompletionResolution, TodoistTaskRecord } from '../../domain/task';

export function buildTaskAddSuccessEmbed(task: TodoistTaskRecord) {
  return buildTaskEmbed('Task Created', task, 'Created in Todoist.');
}

export function buildTaskDoneSuccessEmbed(task: TodoistTaskRecord) {
  return buildTaskEmbed('Task Completed', task, 'Marked complete in Todoist.');
}

export function buildTaskEditSuccessEmbed(task: TodoistTaskRecord) {
  return buildTaskEmbed('Task Updated', task, 'Updated in Todoist.');
}

export function buildTaskDeleteSuccessEmbed(task: TodoistTaskRecord) {
  return buildTaskEmbed('Task Deleted', task, 'Deleted from Todoist.');
}

export function buildTaskReopenSuccessEmbed(task: TodoistTaskRecord) {
  return buildTaskEmbed('Task Reopened', task, 'Moved back to active tasks in Todoist.');
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

function buildTaskEmbed(title: string, task: TodoistTaskRecord, statusMessage: string) {
  const fields = [
    {
      name: 'Status',
      value: statusMessage,
      inline: false,
    },
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
  ];

  if (task.projectName) {
    fields.push({
      name: 'Project',
      value: task.projectName,
      inline: true,
    });
  }

  if (task.labels && task.labels.length > 0) {
    fields.push({
      name: 'Labels',
      value: task.labels.join(', '),
      inline: false,
    });
  }

  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(`[${escapeMarkdown(task.title)}](${task.url})`)
    .addFields(fields)
    .setTimestamp(new Date());
}

function escapeMarkdown(value: string) {
  return value.replaceAll('[', '\\[').replaceAll(']', '\\]');
}
