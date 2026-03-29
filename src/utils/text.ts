export function normalizeTaskTitle(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}
