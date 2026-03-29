import type { TodoistTaskRecord } from '../../domain/task';

const DISCORD_AUTOCOMPLETE_NAME_LIMIT = 100;

export function buildTaskAutocompleteLabel(task: TodoistTaskRecord) {
  const suffixParts = [task.projectName, task.dueLabel].filter(Boolean);
  const suffix = suffixParts.length > 0 ? ` · ${suffixParts.join(' · ')}` : '';
  const raw = `${task.title}${suffix}`;

  if (raw.length <= DISCORD_AUTOCOMPLETE_NAME_LIMIT) {
    return raw;
  }

  return `${raw.slice(0, DISCORD_AUTOCOMPLETE_NAME_LIMIT - 1)}…`;
}
