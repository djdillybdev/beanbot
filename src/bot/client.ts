import {
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  type Interaction,
} from 'discord.js';

import { handleChatInputCommand, type CommandDependencies } from './handlers';

export function createDiscordClient(
  logger: Pick<Console, 'info' | 'error'>,
  dependencies: CommandDependencies,
) {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });

  client.once(Events.ClientReady, (readyClient) => {
    logger.info(`Discord client logged in as ${readyClient.user.tag}`);
  });

  client.on(Events.InteractionCreate, async (interaction: Interaction) => {
    if (!interaction.isChatInputCommand()) {
      return;
    }

    try {
      await handleChatInputCommand(interaction, dependencies);
    } catch (error) {
      logger.error('Failed to handle interaction', error);

      const message = 'Command execution failed. Check the bot logs for details.';

      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral });
        return;
      }

      await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
    }
  });

  return {
    client,
    async start() {
      await client.login(dependencies.config.env.DISCORD_TOKEN);
    },
  };
}
