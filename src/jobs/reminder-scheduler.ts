import type { Client } from 'discord.js';

import { ReminderService } from '../app/reminders/reminder-service';
import type { Logger } from '../logging/logger';

const REMINDER_SCAN_INTERVAL_MS = 60_000;
const REMINDER_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface ReminderScheduler {
  stop: () => void;
}

export function startReminderScheduler(
  client: Client,
  reminderService: ReminderService,
  logger: Logger,
): ReminderScheduler {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let lastCleanupAt = 0;

  const runCycle = async (reason: 'startup' | 'scheduled') => {
    try {
      logger.info('Running reminder scan', { reason });
      const now = new Date();
      await reminderService.syncUpcomingReminders(now);
      await reminderService.retryFailedReminders(now);
      await reminderService.deliverDueReminders(client, now);

      if (Date.now() - lastCleanupAt >= REMINDER_CLEANUP_INTERVAL_MS) {
        await reminderService.pruneFinishedReminders(now);
        lastCleanupAt = Date.now();
      }
    } catch (error) {
      logger.error('Reminder scan failed', error, { reason });
    } finally {
      if (!stopped) {
        timer = setTimeout(() => {
          void runCycle('scheduled');
        }, REMINDER_SCAN_INTERVAL_MS);
      }
    }
  };

  void runCycle('startup');

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
