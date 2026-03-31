export const OBSIDIAN_EFFORT_LABELS = ['quick', 'easy', 'flow', 'personal'] as const;

export type ObsidianEffort = (typeof OBSIDIAN_EFFORT_LABELS)[number];

export function mergeReservedLabels(
  project: string | undefined,
  effort: ObsidianEffort | undefined,
  labels: string[],
) {
  const nextLabels = [...labels];

  if (project) {
    nextLabels.push(`proj:${slugify(project)}`);
  }

  if (effort) {
    nextLabels.push(effort);
  }

  return nextLabels.sort((left, right) => left.localeCompare(right));
}

export function splitReservedLabels(labels?: string[]) {
  const effortLabels = (labels ?? []).filter(isObsidianEffortLabel);
  const effort = pickEffortLabel(effortLabels);
  const projectLabel = labels?.find((label) => label.startsWith('proj:'));
  const otherLabels = (labels ?? []).filter((label) => label !== projectLabel && !isObsidianEffortLabel(label));

  return {
    project: projectLabel ? humanizeProjectSlug(projectLabel.slice('proj:'.length)) : undefined,
    effort,
    labels: otherLabels,
    hadEffortConflict: effortLabels.length > 1,
  };
}

export function parseEffortList(value: string[]) {
  const normalized = value
    .map((item) => item.trim().toLowerCase())
    .filter((item): item is ObsidianEffort => isObsidianEffortLabel(item));

  return {
    effort: pickEffortLabel(normalized),
    hadConflict: normalized.length > 1,
  };
}

export function isObsidianEffortLabel(value: string): value is ObsidianEffort {
  return (OBSIDIAN_EFFORT_LABELS as readonly string[]).includes(value);
}

export function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function pickEffortLabel(labels: ObsidianEffort[]) {
  if (labels.length === 0) {
    return undefined;
  }

  return [...labels].sort((left, right) => effortPriority(left) - effortPriority(right))[0];
}

function effortPriority(value: ObsidianEffort) {
  return OBSIDIAN_EFFORT_LABELS.indexOf(value);
}

function humanizeProjectSlug(slug: string) {
  return slug
    .split('-')
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
