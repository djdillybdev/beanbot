import type { Logger } from '../logging/logger';
import type { LiveStatusRefresher } from '../app/today/today-status-service';

export async function syncLiveStatus(
  liveStatusService: LiveStatusRefresher,
  logger: Logger,
  reason: string,
) {
  await liveStatusService.refreshCurrentStatus(reason);
  logger.debug('Synchronized live status message', { reason });
}
