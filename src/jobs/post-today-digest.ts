import {
  ChannelType,
  type Client,
  type GuildBasedChannel,
  type TextChannel,
} from 'discord.js';

import { TodayReviewService } from '../app/today/get-today-review';
import type { AppConfig } from '../config';
import { buildTodayEmbeds } from '../bot/renderers/today';

export async function postTodayDigest(
  client: Client,
  config: AppConfig,
  todayReviewService: TodayReviewService,
  logger: Pick<Console, 'info' | 'error'>,
) {
  const channel = await resolveTodayChannel(client, config.todayChannelId);
  const review = await todayReviewService.getReview();
  const embeds = buildTodayEmbeds(config, review);

  await channel.send({ embeds });
  logger.info(`Posted today digest to channel ${config.todayChannelId}`);
}

async function resolveTodayChannel(client: Client, channelId: string): Promise<TextChannel> {
  const cached = client.channels.cache.get(channelId);
  const fetched = cached ?? (await client.channels.fetch(channelId));

  if (!fetched) {
    throw new Error(`Configured TODAY_CHANNEL_ID ${channelId} was not found.`);
  }

  if (!fetched.isDMBased() && isGuildTextChannel(fetched)) {
    return fetched;
  }

  if (fetched.isDMBased()) {
    throw new Error(`Configured TODAY_CHANNEL_ID ${channelId} is not a text channel.`);
  }

  throw new Error(`Configured TODAY_CHANNEL_ID ${channelId} is not a text channel.`);
}

function isGuildTextChannel(channel: GuildBasedChannel): channel is TextChannel {
  return channel.type === ChannelType.GuildText;
}
