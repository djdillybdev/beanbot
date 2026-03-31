import type { HabitActiveStatus, HabitMetrics, HabitSchedule, HabitWeekday } from '../../domain/habit';

const WEEKDAYS: HabitWeekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const WEEKDAY_SET = new Set<HabitWeekday>(WEEKDAYS);

const WEEKDAY_ALIASES: Record<string, HabitWeekday> = {
  mon: 'mon',
  monday: 'mon',
  tue: 'tue',
  tues: 'tue',
  tuesday: 'tue',
  wed: 'wed',
  weds: 'wed',
  wednesday: 'wed',
  thu: 'thu',
  thur: 'thu',
  thurs: 'thu',
  thursday: 'thu',
  fri: 'fri',
  friday: 'fri',
  sat: 'sat',
  saturday: 'sat',
  sun: 'sun',
  sunday: 'sun',
};

export function normalizeHabitSchedule(rawText: string | undefined, recurring: boolean | undefined): HabitSchedule {
  const trimmed = rawText?.trim();

  if (!recurring || !trimmed) {
    return { kind: 'unparsed', rawText: trimmed };
  }

  const normalized = trimmed.toLowerCase().replace(/\s+/g, ' ');

  if (normalized === 'every day' || normalized === 'daily' || normalized === 'everyday') {
    return { kind: 'daily', rawText: trimmed };
  }

  if (
    normalized === 'every weekday' ||
    normalized === 'weekdays' ||
    normalized === 'every workday' ||
    normalized === 'workdays'
  ) {
    return { kind: 'weekly_days', rawText: trimmed, daysOfWeek: ['mon', 'tue', 'wed', 'thu', 'fri'] };
  }

  const intervalMatch = normalized.match(/^every (\d+) days?$/);

  if (intervalMatch) {
    return {
      kind: 'interval_days',
      rawText: trimmed,
      intervalDays: Number(intervalMatch[1]),
    };
  }

  const weeklyDays = parseWeeklyDays(normalized);

  if (weeklyDays.length > 0) {
    return { kind: 'weekly_days', rawText: trimmed, daysOfWeek: weeklyDays };
  }

  return { kind: 'unparsed', rawText: trimmed };
}

export function computeHabitMetrics(
  today: string,
  schedule: HabitSchedule,
  completionDates: string[],
  options?: { activeStatus?: HabitActiveStatus },
): HabitMetrics {
  const uniqueDates = Array.from(new Set(completionDates)).sort((left, right) => left.localeCompare(right));
  const lastCompletedLocalDate = uniqueDates.at(-1);

  if (uniqueDates.length === 0) {
    return {
      currentStreak: 0,
      longestStreak: 0,
      lastCompletedLocalDate: undefined,
      completionCount: 0,
    };
  }

  switch (schedule.kind) {
    case 'daily':
    case 'weekly_days':
      return applyActiveStatus({
        currentStreak: computeScheduledDayCurrentStreak(today, schedule, new Set(uniqueDates)),
        longestStreak: computeScheduledDayLongestStreak(today, schedule, new Set(uniqueDates)),
        lastCompletedLocalDate,
        completionCount: uniqueDates.length,
      }, options?.activeStatus);
    case 'interval_days':
      return applyActiveStatus({
        currentStreak: computeIntervalCurrentStreak(today, schedule.intervalDays ?? 0, uniqueDates),
        longestStreak: computeIntervalLongestStreak(schedule.intervalDays ?? 0, uniqueDates),
        lastCompletedLocalDate,
        completionCount: uniqueDates.length,
      }, options?.activeStatus);
    case 'unparsed':
    default:
      return {
        currentStreak: 0,
        longestStreak: 0,
        lastCompletedLocalDate,
        completionCount: uniqueDates.length,
      };
  }
}

function applyActiveStatus(metrics: HabitMetrics, activeStatus?: HabitActiveStatus) {
  if (activeStatus === 'overdue') {
    return {
      ...metrics,
      currentStreak: 0,
    };
  }

  return metrics;
}

function parseWeeklyDays(normalized: string): HabitWeekday[] {
  if (!normalized.startsWith('every ')) {
    return [];
  }

  const remainder = normalized.slice('every '.length);
  const tokens = remainder
    .replace(/\band\b/g, ',')
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  if (tokens.length === 0) {
    return [];
  }

  const days: HabitWeekday[] = [];

  for (const token of tokens) {
    const day = WEEKDAY_ALIASES[token];

    if (!day || WEEKDAY_SET.has(day) === false) {
      return [];
    }

    if (!days.includes(day)) {
      days.push(day);
    }
  }

  return WEEKDAYS.filter((day) => days.includes(day));
}

function computeScheduledDayCurrentStreak(today: string, schedule: HabitSchedule, completions: Set<string>) {
  let cursor = completions.has(today) ? today : getPreviousScheduledDate(today, schedule);
  let streak = 0;

  while (cursor) {
    if (!completions.has(cursor)) {
      break;
    }

    streak += 1;
    cursor = getPreviousScheduledDate(cursor, schedule);
  }

  return streak;
}

function computeScheduledDayLongestStreak(today: string, schedule: HabitSchedule, completions: Set<string>) {
  const sortedCompletions = Array.from(completions).sort((left, right) => left.localeCompare(right));

  if (sortedCompletions.length === 0) {
    return 0;
  }

  let streak = 0;
  let longest = 0;
  let cursor = getFirstScheduledDate(sortedCompletions[0]!, schedule);

  while (cursor <= today) {
    if (completions.has(cursor)) {
      streak += 1;
      longest = Math.max(longest, streak);
    } else if (isScheduledOnDate(cursor, schedule)) {
      streak = 0;
    }

    cursor = addDays(cursor, 1);
  }

  return longest;
}

function computeIntervalCurrentStreak(today: string, intervalDays: number, completionDates: string[]) {
  if (intervalDays < 1 || completionDates.length === 0) {
    return 0;
  }

  const lastDate = completionDates.at(-1);

  if (!lastDate || diffInDays(lastDate, today) > intervalDays) {
    return 0;
  }

  let streak = 1;

  for (let index = completionDates.length - 1; index > 0; index -= 1) {
    const current = completionDates[index];
    const previous = completionDates[index - 1];

    if (!current || !previous || diffInDays(previous, current) > intervalDays) {
      break;
    }

    streak += 1;
  }

  return streak;
}

function computeIntervalLongestStreak(intervalDays: number, completionDates: string[]) {
  if (intervalDays < 1 || completionDates.length === 0) {
    return 0;
  }

  let streak = 1;
  let longest = 1;

  for (let index = 1; index < completionDates.length; index += 1) {
    const current = completionDates[index];
    const previous = completionDates[index - 1];

    if (!current || !previous) {
      continue;
    }

    if (diffInDays(previous, current) <= intervalDays) {
      streak += 1;
      longest = Math.max(longest, streak);
    } else {
      streak = 1;
    }
  }

  return longest;
}

function getFirstScheduledDate(startDate: string, schedule: HabitSchedule) {
  if (schedule.kind !== 'weekly_days') {
    return startDate;
  }

  let cursor = startDate;

  while (!isScheduledOnDate(cursor, schedule)) {
    cursor = addDays(cursor, 1);
  }

  return cursor;
}

function getPreviousScheduledDate(date: string, schedule: HabitSchedule) {
  let cursor = addDays(date, -1);

  while (cursor >= '1970-01-01') {
    if (isScheduledOnDate(cursor, schedule)) {
      return cursor;
    }

    cursor = addDays(cursor, -1);
  }

  return null;
}

function isScheduledOnDate(date: string, schedule: HabitSchedule) {
  switch (schedule.kind) {
    case 'daily':
      return true;
    case 'weekly_days': {
      const weekday = getWeekday(date);
      return Boolean(schedule.daysOfWeek?.includes(weekday));
    }
    default:
      return false;
  }
}

function getWeekday(date: string): HabitWeekday {
  const weekday = new Date(`${date}T12:00:00.000Z`)
    .toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })
    .toLowerCase();

  const normalized = WEEKDAY_ALIASES[weekday];

  if (!normalized) {
    throw new Error(`Unsupported weekday: ${date}`);
  }

  return normalized;
}

function addDays(date: string, days: number) {
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    throw new Error(`Invalid ISO date: ${date}`);
  }

  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days))
    .toISOString()
    .slice(0, 10);
}

function diffInDays(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}
