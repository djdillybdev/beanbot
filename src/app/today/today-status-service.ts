import type { Client, Message, TextChannel } from 'discord.js';

import type { AppConfig } from '../../config';
import { TodayStatusMessageRepository } from '../../db/today-status-message-repository';
import type { DailyReviewResult } from '../../domain/daily-review';
import type { Logger } from '../../logging/logger';
import { getZonedDayBounds } from '../../utils/time';
import { buildTodayStatusEmbeds } from '../../bot/renderers/today';
import { resolveTextChannel } from '../../jobs/resolve-text-channel';
import { TodayReviewService } from './get-today-review';

export class TodayStatusService {
  constructor(
    private readonly client: Client,
    private readonly config: AppConfig,
    private readonly todayReviewService: TodayReviewService,
    private readonly repository: TodayStatusMessageRepository,
    private readonly logger: Logger,
  ) {}

  async refreshCurrentDayStatus(reason: string, now = new Date()) {
    const { localDate } = getZonedDayBounds(now, this.config.timezone);
    const channel = await resolveTextChannel(this.client, this.config.todayChannelId, 'TODAY_CHANNEL_ID');
    const review = await this.todayReviewService.getReview(now);
    const snapshotJson = buildTodayStatusSnapshot(localDate, review);
    const existing = await this.repository.findByDateKey(localDate, this.config.todayChannelId);

    if (!existing) {
      await this.createNewDayStatusMessage(channel, localDate, review, snapshotJson, reason);
      return;
    }

    const message = await this.fetchExistingMessage(channel, existing.messageId, localDate);

    if (!message) {
      await this.createReplacementDayStatusMessage(channel, localDate, review, snapshotJson, reason);
      return;
    }

    if (existing.snapshotJson !== snapshotJson) {
      await message.edit({
        embeds: buildTodayStatusEmbeds(this.config, localDate, review, now),
      });
      await this.repository.upsert({
        dateKey: localDate,
        channelId: this.config.todayChannelId,
        messageId: message.id,
        snapshotJson,
        isPinned: existing.isPinned,
      });
      this.logger.info('Updated today status message', {
        reason,
        dateKey: localDate,
        channelId: this.config.todayChannelId,
        messageId: message.id,
      });
    } else {
      this.logger.debug('Skipped today status edit because rendered snapshot is unchanged.', {
        reason,
        dateKey: localDate,
        channelId: this.config.todayChannelId,
        messageId: message.id,
      });
    }

    await this.ensureCurrentMessagePinned(localDate, message);
    await this.unpinOlderMessages(localDate, channel);
  }

  private async createNewDayStatusMessage(
    channel: TextChannel,
    localDate: string,
    review: DailyReviewResult,
    snapshotJson: string,
    reason: string,
  ) {
    const message = await channel.send({
      embeds: buildTodayStatusEmbeds(this.config, localDate, review, new Date()),
    });

    await this.repository.upsert({
      dateKey: localDate,
      channelId: this.config.todayChannelId,
      messageId: message.id,
      snapshotJson,
      isPinned: false,
    });

    await this.ensureCurrentMessagePinned(localDate, message);
    await this.unpinOlderMessages(localDate, channel);
    this.logger.info('Created today status message', {
      reason,
      dateKey: localDate,
      channelId: this.config.todayChannelId,
      messageId: message.id,
    });
  }

  private async createReplacementDayStatusMessage(
    channel: TextChannel,
    localDate: string,
    review: DailyReviewResult,
    snapshotJson: string,
    reason: string,
  ) {
    const message = await channel.send({
      embeds: buildTodayStatusEmbeds(this.config, localDate, review, new Date()),
    });

    await this.repository.upsert({
      dateKey: localDate,
      channelId: this.config.todayChannelId,
      messageId: message.id,
      snapshotJson,
      isPinned: false,
    });

    await this.ensureCurrentMessagePinned(localDate, message);
    await this.unpinOlderMessages(localDate, channel);
    this.logger.warn('Recreated missing today status message', {
      reason,
      dateKey: localDate,
      channelId: this.config.todayChannelId,
      messageId: message.id,
    });
  }

  private async fetchExistingMessage(channel: TextChannel, messageId: string, dateKey: string) {
    try {
      return await channel.messages.fetch(messageId);
    } catch (error) {
      this.logger.warn('Stored today status message could not be fetched and will be recreated.', {
        dateKey,
        channelId: this.config.todayChannelId,
        messageId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private async ensureCurrentMessagePinned(dateKey: string, message: Message) {
    if (message.pinned) {
      await this.repository.markPinned(dateKey, true);
      return;
    }

    try {
      await message.pin();
      await this.repository.markPinned(dateKey, true);
      this.logger.info('Pinned active today status message', {
        dateKey,
        messageId: message.id,
      });
    } catch (error) {
      this.logger.warn('Failed to pin active today status message.', {
        dateKey,
        messageId: message.id,
        error: error instanceof Error ? error.message : String(error),
      });
      await this.repository.markPinned(dateKey, false);
    }
  }

  private async unpinOlderMessages(currentDateKey: string, channel: TextChannel) {
    const previousPinnedRecords = await this.repository.listOtherPinned(this.config.todayChannelId, currentDateKey);

    for (const record of previousPinnedRecords) {
      try {
        const message = await channel.messages.fetch(record.messageId);

        if (message.pinned) {
          await message.unpin();
        }

        await this.repository.markPinned(record.dateKey, false);
        this.logger.info('Unpinned historical today status message', {
          dateKey: record.dateKey,
          messageId: record.messageId,
        });
      } catch (error) {
        this.logger.warn('Failed to unpin historical today status message.', {
          dateKey: record.dateKey,
          messageId: record.messageId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}

function buildTodayStatusSnapshot(localDate: string, review: DailyReviewResult) {
  return JSON.stringify({
    dateKey: localDate,
    overdueTasks: review.overdueTasks.map((task) => ({
      id: task.id,
      title: task.title,
      dueLabel: task.dueLabel,
      priority: task.priority,
    })),
    dueTodayTasks: review.dueTodayTasks.map((task) => ({
      id: task.id,
      title: task.title,
      dueLabel: task.dueLabel,
      priority: task.priority,
    })),
    completedTodayTasks: review.completedTodayTasks.map((task) => ({
      id: task.id,
      title: task.title,
      completedAtUtc: task.completedAtUtc,
      priority: task.priority,
    })),
    todayEvents: review.todayEvents.map((event) => ({
      id: event.id,
      title: event.title,
      startLabel: event.startLabel,
    })),
    todoistStatusMessage: review.todoistStatus.message ?? null,
    googleCalendarStatusMessage: review.googleCalendarStatus.message ?? null,
  });
}
