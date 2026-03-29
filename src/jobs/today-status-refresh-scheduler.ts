import type { Logger } from '../logging/logger';
import { TodayStatusService } from '../app/today/today-status-service';

const TODAY_STATUS_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

export interface TodayStatusRefreshScheduler {
  stop: () => void;
}

export function startTodayStatusRefreshScheduler(
  todayStatusService: TodayStatusService,
  logger: Logger,
): TodayStatusRefreshScheduler {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const runCycle = async () => {
    try {
      logger.debug('Running scheduled today status refresh poll');
      await todayStatusService.refreshCurrentDayStatus('scheduled-poll');
    } catch (error) {
      logger.error('Today status refresh poll failed', error);
    } finally {
      if (!stopped) {
        timer = setTimeout(() => {
          void runCycle();
        }, TODAY_STATUS_REFRESH_INTERVAL_MS);
      }
    }
  };

  timer = setTimeout(() => {
    void runCycle();
  }, TODAY_STATUS_REFRESH_INTERVAL_MS);

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
