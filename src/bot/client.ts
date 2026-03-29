import {
  type AutocompleteInteraction,
  type ButtonInteraction,
  Client,
  Events,
  GatewayIntentBits,
  type Message,
  MessageFlags,
  type Interaction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';

import {
  handleAutocompleteInteraction,
  handleChatInputCommand,
  handleInboxMessage,
  handleMessageComponentInteraction,
  handleModalSubmitInteraction,
  type CommandDependencies,
} from './handlers';
import type { Logger } from '../logging/logger';

export function createDiscordClient(
  logger: Logger,
  dependencies: CommandDependencies,
) {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  client.once(Events.ClientReady, (readyClient) => {
    logger.info('Discord client ready', { userTag: readyClient.user.tag });
  });

  client.on(Events.InteractionCreate, async (interaction: Interaction) => {
    try {
      logger.debug('Received Discord interaction', {
        interactionType: interaction.type,
        interactionId: interaction.id,
        commandName: interaction.isChatInputCommand() ? interaction.commandName : undefined,
        customId:
          interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit()
            ? interaction.customId
            : undefined,
        channelId: interaction.channelId ?? undefined,
        userId: interaction.user?.id,
      });

      if (interaction.isAutocomplete()) {
        await handleAutocompleteInteraction(interaction as AutocompleteInteraction, dependencies);
        logger.debug('Handled autocomplete interaction', {
          interactionId: interaction.id,
          commandName: interaction.commandName,
          channelId: interaction.channelId ?? undefined,
        });
        return;
      }

      if (interaction.isModalSubmit()) {
        await handleModalSubmitInteraction(interaction as ModalSubmitInteraction, dependencies);
        logger.debug('Handled modal submission', {
          interactionId: interaction.id,
          customId: interaction.customId,
          channelId: interaction.channelId ?? undefined,
        });
        return;
      }

      if (interaction.isButton() || interaction.isStringSelectMenu()) {
        await handleMessageComponentInteraction(
          interaction as ButtonInteraction | StringSelectMenuInteraction,
          dependencies,
        );
        logger.debug('Handled message component interaction', {
          interactionId: interaction.id,
          customId: interaction.customId,
          channelId: interaction.channelId ?? undefined,
        });
        return;
      }

      if (!interaction.isChatInputCommand()) {
        return;
      }

      await handleChatInputCommand(interaction, dependencies);
      logger.debug('Handled chat input command', {
        interactionId: interaction.id,
        commandName: interaction.commandName,
        channelId: interaction.channelId ?? undefined,
      });
    } catch (error) {
      logger.error('Failed to handle interaction', error, {
        interactionId: interaction.id,
        commandName: interaction.isChatInputCommand() ? interaction.commandName : undefined,
        channelId: interaction.channelId ?? undefined,
      });

      const message = formatUserFacingError(error, dependencies);

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

  client.on(Events.MessageCreate, async (message: Message) => {
    try {
      await handleInboxMessage(message, dependencies);
      if (
        message.inGuild() &&
        !message.author.bot &&
        !message.system &&
        !message.webhookId &&
        message.channelId === dependencies.config.inboxChannelId
      ) {
        logger.debug('Handled inbox message', {
          channelId: message.channelId,
          authorId: message.author.id,
          messageId: message.id,
          contentLength: message.content.length,
        });
      }
    } catch (error) {
      logger.error('Failed to handle inbox message', error, {
        channelId: message.channelId,
        authorId: message.author.id,
        messageId: message.id,
        contentLength: message.content.length,
      });

      if (!message.inGuild() || message.author.bot) {
        return;
      }

      const content = formatUserFacingError(error, dependencies);
      await message.reply({ content });
    }
  });

  return {
    client,
    async start() {
      await client.login(dependencies.config.env.DISCORD_TOKEN);
    },
  };
}

function formatUserFacingError(error: unknown, dependencies: CommandDependencies) {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes('Todoist is not connected')) {
    return `Todoist is not connected. Connect it here: ${dependencies.config.publicBaseUrl}/auth/todoist/start`;
  }

  if (message.includes('Google Calendar is not connected')) {
    return `Google Calendar is not connected. Connect it here: ${dependencies.config.publicBaseUrl}/auth/google/start`;
  }

  if (message.startsWith('Todoist quick add failed:')) {
    return 'Todoist rejected that inbox task. Edit the message and try a simpler quick-add phrase.';
  }

  if (message.startsWith('Todoist')) {
    return 'Todoist request failed. Check the Todoist connection and try again.';
  }

  return message || 'Command execution failed. Check the bot logs for details.';
}
