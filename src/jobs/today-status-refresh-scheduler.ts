import type { Logger } from '../logging/logger';
import type { LiveStatusRefresher } from '../app/today/today-status-service';

const TODAY_STATUS_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

export interface TodayStatusRefreshScheduler {
  stop: () => void;
}

export function startLiveStatusRefreshScheduler(
  liveStatusService: LiveStatusRefresher,
  logger: Logger,
  label: string,
): TodayStatusRefreshScheduler {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const runCycle = async () => {
    try {
      logger.debug('Running scheduled live status refresh poll', { label });
      await liveStatusService.refreshCurrentStatus('scheduled-poll');
    } catch (error) {
      logger.error('Live status refresh poll failed', error, { label });
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

export const startTodayStatusRefreshScheduler = startLiveStatusRefreshScheduler;
