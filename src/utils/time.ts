export function getLocalDateParts(date: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const parts = formatter.formatToParts(date);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return {
    year: lookup.year,
    month: lookup.month,
    day: lookup.day,
    date: `${lookup.year}-${lookup.month}-${lookup.day}`,
  };
}

export function formatLocalTime(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export function formatLocalDayLabel(dateKey: string, timezone: string): string {
  const utcDate = new Date(`${dateKey}T12:00:00.000Z`);

  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(utcDate);
}

export function getZonedDayBounds(date: Date, timezone: string) {
  const today = getLocalDateParts(date, timezone).date;
  const tomorrow = addDays(today, 1);

  return {
    localDate: today,
    startUtc: new Date(localMidnightToUtc(today, timezone)).toISOString(),
    endUtc: new Date(localMidnightToUtc(tomorrow, timezone)).toISOString(),
  };
}

export function getUpcomingDayBounds(date: Date, timezone: string, days: number) {
  const start = getLocalDateParts(date, timezone).date;
  const endExclusive = addDays(start, days);

  return {
    startDate: start,
    endExclusiveDate: endExclusive,
    startUtc: new Date(localMidnightToUtc(start, timezone)).toISOString(),
    endUtc: new Date(localMidnightToUtc(endExclusive, timezone)).toISOString(),
  };
}

export function getDateKeysInRange(startDate: string, dayCount: number): string[] {
  return Array.from({ length: dayCount }, (_, index) => addDays(startDate, index));
}

function addDays(dateString: string, days: number): string {
  const { year, month, day } = parseIsoDate(dateString);
  const date = new Date(Date.UTC(year, month - 1, day + days));

  return date.toISOString().slice(0, 10);
}

function localMidnightToUtc(localDate: string, timezone: string): number {
  const { year, month, day } = parseIsoDate(localDate);
  const naiveUtcMs = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  let offsetMinutes = getOffsetMinutes(new Date(naiveUtcMs), timezone);
  let adjustedMs = naiveUtcMs - offsetMinutes * 60_000;
  const adjustedOffset = getOffsetMinutes(new Date(adjustedMs), timezone);

  if (adjustedOffset !== offsetMinutes) {
    offsetMinutes = adjustedOffset;
    adjustedMs = naiveUtcMs - offsetMinutes * 60_000;
  }

  return adjustedMs;
}

function getOffsetMinutes(date: Date, timezone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    timeZoneName: 'shortOffset',
    hour: '2-digit',
  });
  const parts = formatter.formatToParts(date);
  const offset = parts.find((part) => part.type === 'timeZoneName')?.value;

  if (!offset || offset === 'GMT') {
    return 0;
  }

  const match = offset.match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/);

  if (!match) {
    throw new Error(`Unsupported timezone offset format: ${offset}`);
  }

  const sign = match[1] === '-' ? -1 : 1;
  const hours = Number(match[2]);
  const minutes = Number(match[3] ?? '0');

  return sign * (hours * 60 + minutes);
}

function parseIsoDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    throw new Error(`Invalid ISO date: ${value}`);
  }

  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}
