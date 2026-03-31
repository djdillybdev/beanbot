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

export function getStartOfWeekDate(date: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
  });
  const weekday = formatter.format(date);
  const currentDate = getLocalDateParts(date, timezone).date;
  const offsetDays = getWeekdayOffset(weekday);

  return addDays(currentDate, -offsetDays);
}

export function getWeekBounds(date: Date, timezone: string) {
  const startDate = getStartOfWeekDate(date, timezone);
  const endExclusiveDate = addDays(startDate, 7);

  return {
    startDate,
    endExclusiveDate,
    periodKey: startDate,
    startUtc: new Date(localMidnightToUtc(startDate, timezone)).toISOString(),
    endUtc: new Date(localMidnightToUtc(endExclusiveDate, timezone)).toISOString(),
  };
}

export function getMonthBounds(date: Date, timezone: string) {
  const local = getLocalDateParts(date, timezone);
  const startDate = `${local.year}-${local.month}-01`;
  const nextMonthYear = local.month === '12' ? Number(local.year) + 1 : Number(local.year);
  const nextMonth = local.month === '12' ? 1 : Number(local.month) + 1;
  const endExclusiveDate = `${String(nextMonthYear).padStart(4, '0')}-${String(nextMonth).padStart(2, '0')}-01`;

  return {
    startDate,
    endExclusiveDate,
    periodKey: `${local.year}-${local.month}`,
    startUtc: new Date(localMidnightToUtc(startDate, timezone)).toISOString(),
    endUtc: new Date(localMidnightToUtc(endExclusiveDate, timezone)).toISOString(),
  };
}

export function parseLocalDateTimeInput(value: string, timezone: string): Date {
  const trimmed = value.trim();
  const match = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))$/,
  );

  if (!match) {
    throw new Error('Use date/time format YYYY-MM-DD HH:mm.');
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);

  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) {
    throw new Error('Use a valid local date/time in format YYYY-MM-DD HH:mm.');
  }

  const naiveUtcMs = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let offsetMinutes = getOffsetMinutes(new Date(naiveUtcMs), timezone);
  let adjustedMs = naiveUtcMs - offsetMinutes * 60_000;
  const adjustedOffset = getOffsetMinutes(new Date(adjustedMs), timezone);

  if (adjustedOffset !== offsetMinutes) {
    offsetMinutes = adjustedOffset;
    adjustedMs = naiveUtcMs - offsetMinutes * 60_000;
  }

  const parts = getLocalDateTimeParts(new Date(adjustedMs), timezone);

  if (
    parts.year !== String(year) ||
    parts.month !== String(month).padStart(2, '0') ||
    parts.day !== String(day).padStart(2, '0') ||
    parts.hour !== String(hour).padStart(2, '0') ||
    parts.minute !== String(minute).padStart(2, '0')
  ) {
    throw new Error(`"${trimmed}" is not a valid local time in ${timezone}.`);
  }

  return new Date(adjustedMs);
}

export function formatLocalDateTimeInput(date: Date, timezone: string): string {
  const parts = getLocalDateTimeParts(date, timezone);
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

export function parseLocalDateTimeProperty(value: string, timezone: string): Date {
  const trimmed = value.trim();

  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(trimmed)) {
    throw new Error('datetime must use YYYY-MM-DDTHH:mm or YYYY-MM-DDTHH:mm:ss.');
  }

  try {
    return parseLocalDateTimeInput(trimmed.slice(0, 16), timezone);
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(error.message);
    }

    throw error;
  }
}

export function formatLocalDateTimeProperty(date: Date, timezone: string): string {
  return `${formatLocalDateTimeInput(date, timezone).replace(' ', 'T')}:00`;
}

export function shiftUtcDatePreservingLocalTime(currentUtcIso: string, nextLocalDate: string, timezone: string): string {
  const currentDate = new Date(currentUtcIso);

  if (Number.isNaN(currentDate.getTime())) {
    throw new Error(`Invalid UTC datetime: ${currentUtcIso}`);
  }

  const parts = getLocalDateTimeParts(currentDate, timezone);
  return parseLocalDateTimeInput(`${nextLocalDate} ${parts.hour}:${parts.minute}`, timezone).toISOString();
}

function addDays(dateString: string, days: number): string {
  const { year, month, day } = parseIsoDate(dateString);
  const date = new Date(Date.UTC(year, month - 1, day + days));

  return date.toISOString().slice(0, 10);
}

function getWeekdayOffset(weekday: string) {
  switch (weekday) {
    case 'Mon':
      return 0;
    case 'Tue':
      return 1;
    case 'Wed':
      return 2;
    case 'Thu':
      return 3;
    case 'Fri':
      return 4;
    case 'Sat':
      return 5;
    case 'Sun':
      return 6;
    default:
      throw new Error(`Unsupported weekday value: ${weekday}`);
  }
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

function getLocalDateTimeParts(date: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return {
    year: lookup.year,
    month: lookup.month,
    day: lookup.day,
    hour: lookup.hour,
    minute: lookup.minute,
  };
}
