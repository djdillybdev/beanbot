export function mergeProjectLabel(project: string | undefined, labels: string[]) {
  const nextLabels = [...labels];

  if (project) {
    nextLabels.push(`proj:${slugify(project)}`);
  }

  return nextLabels.sort((left, right) => left.localeCompare(right));
}

export function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}
