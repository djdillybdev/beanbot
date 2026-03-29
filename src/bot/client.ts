import {
  type AutocompleteInteraction,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  type Interaction,
  type ModalSubmitInteraction,
} from 'discord.js';

import {
  handleAutocompleteInteraction,
  handleChatInputCommand,
  handleModalSubmitInteraction,
  type CommandDependencies,
} from './handlers';

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
    try {
      if (interaction.isAutocomplete()) {
        await handleAutocompleteInteraction(interaction as AutocompleteInteraction, dependencies);
        return;
      }

      if (interaction.isModalSubmit()) {
        await handleModalSubmitInteraction(interaction as ModalSubmitInteraction, dependencies);
        return;
      }

      if (!interaction.isChatInputCommand()) {
        return;
      }

      await handleChatInputCommand(interaction, dependencies);
    } catch (error) {
      logger.error('Failed to handle interaction', error);

      const message = 'Command execution failed. Check the bot logs for details.';

      if (interaction.isAutocomplete()) {
        try {
          await interaction.respond([]);
        } catch {
          // Ignore failed autocomplete fallback responses.
        }
        return;
      }

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
