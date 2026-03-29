import type { Logger } from '../../logging/logger';

export class TodayStatusRefreshNotifier {
  private handler?: (reason: string) => Promise<void>;
  private inFlight = false;
  private pendingReason: string | null = null;

  constructor(private readonly logger?: Logger) {}

  setHandler(handler: (reason: string) => Promise<void>) {
    this.handler = handler;
  }

  requestRefresh(reason: string) {
    if (!this.handler) {
      this.logger?.debug('Skipped today status refresh request because no handler is attached yet.', {
        reason,
      });
      return;
    }

    if (this.inFlight) {
      this.pendingReason = reason;
      this.logger?.debug('Queued today status refresh while another refresh is already running.', {
        reason,
      });
      return;
    }

    void this.run(reason);
  }

  private async run(reason: string) {
    const handler = this.handler;

    if (!handler) {
      return;
    }

    this.inFlight = true;

    try {
      await handler(reason);
    } catch (error) {
      this.logger?.error('Today status refresh request failed', error, { reason });
    } finally {
      this.inFlight = false;

      if (this.pendingReason) {
        const nextReason = this.pendingReason;
        this.pendingReason = null;
        void this.run(nextReason);
      }
    }
  }
}
