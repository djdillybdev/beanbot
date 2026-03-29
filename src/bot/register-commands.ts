import { REST, Routes } from 'discord.js';

import type { AppConfig } from '../config';
import { slashCommandPayload } from './commands';

export async function registerGuildCommands(config: AppConfig): Promise<void> {
  const rest = new REST({ version: '10' }).setToken(config.env.DISCORD_TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(
      config.env.DISCORD_APPLICATION_ID,
      config.env.DISCORD_GUILD_ID,
    ),
    { body: slashCommandPayload },
  );
}
