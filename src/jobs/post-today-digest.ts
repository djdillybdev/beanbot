import type { Logger } from '../logging/logger';
import { TodayStatusService } from '../app/today/today-status-service';

export async function syncTodayStatus(
  todayStatusService: TodayStatusService,
  logger: Logger,
  reason: string,
) {
  await todayStatusService.refreshCurrentDayStatus(reason);
  logger.debug('Synchronized today status message', { reason });
}
