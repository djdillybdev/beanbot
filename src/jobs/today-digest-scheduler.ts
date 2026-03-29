import type { Logger } from '../logging/logger';
import type { AppConfig } from '../config';
import type { LiveStatusRefresher } from '../app/today/today-status-service';
import { getLocalDateParts } from '../utils/time';
import { syncLiveStatus } from './post-today-digest';

const DAILY_DIGEST_HOUR = 8;

export interface TodayDigestScheduler {
  stop: () => void;
}

export function startTodayDigestScheduler(
  config: AppConfig,
  todayStatusService: LiveStatusRefresher,
  logger: Logger,
): TodayDigestScheduler {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const runDigest = async (reason: 'startup' | 'scheduled') => {
    try {
      logger.info('Running today digest', { reason });
      await syncLiveStatus(todayStatusService, logger, reason);
    } catch (error) {
      logger.error('Today digest failed', error, { reason });
    } finally {
      if (!stopped) {
        scheduleNext();
      }
    }
  };

  const scheduleNext = () => {
    if (timer) {
      clearTimeout(timer);
    }

    const nextRun = getNextDigestRun(config.timezone, DAILY_DIGEST_HOUR);
    const delayMs = Math.max(nextRun.getTime() - Date.now(), 1_000);
    logger.debug('Scheduled next today digest', {
      nextRunUtc: nextRun.toISOString(),
      delayMs,
    });

    timer = setTimeout(() => {
      void runDigest('scheduled');
    }, delayMs);
  };

  void runDigest('startup');

  return {
    stop() {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}

function getNextDigestRun(timezone: string, hour: number) {
  const now = new Date();
  const today = getLocalDateParts(now, timezone).date;
  const nextLocalDate = shouldUseTomorrow(now, timezone, hour) ? addDays(today, 1) : today;

  return new Date(localTimeToUtc(nextLocalDate, hour, timezone));
}

function shouldUseTomorrow(now: Date, timezone: string, hour: number) {
  const localParts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);

  const lookup = Object.fromEntries(localParts.map((part) => [part.type, part.value]));
  const currentHour = Number(lookup.hour ?? '0');
  const currentMinute = Number(lookup.minute ?? '0');

  return currentHour > hour || (currentHour === hour && currentMinute >= 0);
}

function addDays(dateString: string, days: number) {
  const match = dateString.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    throw new Error(`Invalid ISO date: ${dateString}`);
  }

  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return date.toISOString().slice(0, 10);
}

function localTimeToUtc(localDate: string, hour: number, timezone: string) {
  const match = localDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    throw new Error(`Invalid ISO date: ${localDate}`);
  }

  const naiveUtcMs = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    hour,
    0,
    0,
    0,
  );
  let offsetMinutes = getOffsetMinutes(new Date(naiveUtcMs), timezone);
  let adjustedMs = naiveUtcMs - offsetMinutes * 60_000;
  const adjustedOffset = getOffsetMinutes(new Date(adjustedMs), timezone);

  if (adjustedOffset !== offsetMinutes) {
    offsetMinutes = adjustedOffset;
    adjustedMs = naiveUtcMs - offsetMinutes * 60_000;
  }

  return adjustedMs;
}

function getOffsetMinutes(date: Date, timezone: string) {
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

  const parsed = offset.match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/);

  if (!parsed) {
    throw new Error(`Unsupported timezone offset format: ${offset}`);
  }

  const sign = parsed[1] === '-' ? -1 : 1;
  const hours = Number(parsed[2]);
  const minutes = Number(parsed[3] ?? '0');

  return sign * (hours * 60 + minutes);
}
