import {
  ChannelType,
  type Client,
  type GuildBasedChannel,
  type TextChannel,
} from 'discord.js';

export async function resolveTextChannel(client: Client, channelId: string, envName: string): Promise<TextChannel> {
  const cached = client.channels.cache.get(channelId);
  const fetched = cached ?? (await client.channels.fetch(channelId));

  if (!fetched) {
    throw new Error(`Configured ${envName} ${channelId} was not found.`);
  }

  if (!fetched.isDMBased() && isGuildTextChannel(fetched)) {
    return fetched;
  }

  throw new Error(`Configured ${envName} ${channelId} is not a text channel.`);
}

function isGuildTextChannel(channel: GuildBasedChannel): channel is TextChannel {
  return channel.type === ChannelType.GuildText;
}
