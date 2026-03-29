import {
  ChannelType,
  type Client,
  type GuildBasedChannel,
  type TextChannel,
} from 'discord.js';

import { TodayReviewService } from '../app/today/get-today-review';
import type { AppConfig } from '../config';
import { buildTodayEmbeds } from '../bot/renderers/today';
import { resolveTextChannel } from './resolve-text-channel';

export async function postTodayDigest(
  client: Client,
  config: AppConfig,
  todayReviewService: TodayReviewService,
  logger: Pick<Console, 'info' | 'error'>,
) {
  const channel = await resolveTextChannel(client, config.todayChannelId, 'TODAY_CHANNEL_ID');
  const review = await todayReviewService.getReview();
  const embeds = buildTodayEmbeds(config, review);

  await channel.send({ embeds });
  logger.info(`Posted today digest to channel ${config.todayChannelId}`);
}
