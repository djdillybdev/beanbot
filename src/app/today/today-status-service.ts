import type { Client, EmbedBuilder, Message, TextChannel } from 'discord.js';

import type { Logger } from '../../logging/logger';
import { resolveTextChannel } from '../../jobs/resolve-text-channel';
import {
  PeriodStatusMessageRepository,
  type PeriodStatusType,
} from '../../db/period-status-message-repository';

export interface LiveStatusServiceOptions<TReview> {
  client: Client;
  channelId: string;
  channelEnvName: string;
  statusType: PeriodStatusType;
  repository: PeriodStatusMessageRepository;
  logger: Logger;
  getPeriodKey: (now: Date) => string;
  getReview: (now: Date) => Promise<TReview>;
  buildSnapshot: (periodKey: string, review: TReview) => string;
  buildEmbeds: (periodKey: string, review: TReview, updatedAt: Date) => EmbedBuilder[];
  pinActiveMessage?: boolean;
}

export interface LiveStatusRefresher {
  refreshCurrentStatus(reason: string, now?: Date): Promise<void>;
}

export class LiveStatusService<TReview> implements LiveStatusRefresher {
  constructor(private readonly options: LiveStatusServiceOptions<TReview>) {}

  async refreshCurrentStatus(reason: string, now = new Date()) {
    const periodKey = this.options.getPeriodKey(now);
    const channel = await resolveTextChannel(
      this.options.client,
      this.options.channelId,
      this.options.channelEnvName,
    );
    const review = await this.options.getReview(now);
    const snapshotJson = this.options.buildSnapshot(periodKey, review);
    const existing = await this.options.repository.find(
      this.options.statusType,
      periodKey,
      this.options.channelId,
    );

    if (!existing) {
      await this.createStatusMessage(channel, periodKey, review, snapshotJson, reason, 'created');
      return;
    }

    const message = await this.fetchExistingMessage(channel, existing.messageId, periodKey);

    if (!message) {
      await this.createStatusMessage(channel, periodKey, review, snapshotJson, reason, 'recreated');
      return;
    }

    if (existing.snapshotJson !== snapshotJson) {
      await message.edit({
        embeds: this.options.buildEmbeds(periodKey, review, now),
      });
      await this.options.repository.upsert({
        statusType: this.options.statusType,
        periodKey,
        channelId: this.options.channelId,
        messageId: message.id,
        snapshotJson,
        isPinned: existing.isPinned,
      });
      this.options.logger.info('Updated live status message', {
        reason,
        statusType: this.options.statusType,
        periodKey,
        channelId: this.options.channelId,
        messageId: message.id,
      });
    } else {
      this.options.logger.debug('Skipped live status edit because rendered snapshot is unchanged.', {
        reason,
        statusType: this.options.statusType,
        periodKey,
        channelId: this.options.channelId,
        messageId: message.id,
      });
    }

    if (this.options.pinActiveMessage !== false) {
      await this.ensureCurrentMessagePinned(periodKey, message);
      await this.unpinOlderMessages(periodKey, channel);
    }
  }

  private async createStatusMessage(
    channel: TextChannel,
    periodKey: string,
    review: TReview,
    snapshotJson: string,
    reason: string,
    mode: 'created' | 'recreated',
  ) {
    const message = await channel.send({
      embeds: this.options.buildEmbeds(periodKey, review, new Date()),
    });

    await this.options.repository.upsert({
      statusType: this.options.statusType,
      periodKey,
      channelId: this.options.channelId,
      messageId: message.id,
      snapshotJson,
      isPinned: false,
    });

    if (this.options.pinActiveMessage !== false) {
      await this.ensureCurrentMessagePinned(periodKey, message);
      await this.unpinOlderMessages(periodKey, channel);
    }
    this.options.logger[mode === 'created' ? 'info' : 'warn'](
      mode === 'created' ? 'Created live status message' : 'Recreated missing live status message',
      {
        reason,
        statusType: this.options.statusType,
        periodKey,
        channelId: this.options.channelId,
        messageId: message.id,
      },
    );
  }

  private async fetchExistingMessage(channel: TextChannel, messageId: string, periodKey: string) {
    try {
      return await channel.messages.fetch(messageId);
    } catch (error) {
      this.options.logger.warn('Stored live status message could not be fetched and will be recreated.', {
        statusType: this.options.statusType,
        periodKey,
        channelId: this.options.channelId,
        messageId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private async ensureCurrentMessagePinned(periodKey: string, message: Message) {
    if (message.pinned) {
      await this.options.repository.markPinned(this.options.statusType, periodKey, true);
      return;
    }

    try {
      await message.pin();
      await this.options.repository.markPinned(this.options.statusType, periodKey, true);
      this.options.logger.info('Pinned active live status message', {
        statusType: this.options.statusType,
        periodKey,
        messageId: message.id,
      });
    } catch (error) {
      this.options.logger.warn('Failed to pin active live status message.', {
        statusType: this.options.statusType,
        periodKey,
        messageId: message.id,
        error: error instanceof Error ? error.message : String(error),
      });
      await this.options.repository.markPinned(this.options.statusType, periodKey, false);
    }
  }

  private async unpinOlderMessages(currentPeriodKey: string, channel: TextChannel) {
    const previousPinnedRecords = await this.options.repository.listOtherPinned(
      this.options.statusType,
      this.options.channelId,
      currentPeriodKey,
    );

    for (const record of previousPinnedRecords) {
      try {
        const message = await channel.messages.fetch(record.messageId);

        if (message.pinned) {
          await message.unpin();
        }

        await this.options.repository.markPinned(record.statusType, record.periodKey, false);
        this.options.logger.info('Unpinned historical live status message', {
          statusType: this.options.statusType,
          periodKey: record.periodKey,
          messageId: record.messageId,
        });
      } catch (error) {
        this.options.logger.warn('Failed to unpin historical live status message.', {
          statusType: this.options.statusType,
          periodKey: record.periodKey,
          messageId: record.messageId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}
