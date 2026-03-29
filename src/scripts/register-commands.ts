import { createConfig } from '../config';
import { registerGuildCommands } from '../bot/register-commands';
import { createLogger } from '../logging/logger';

async function main() {
  const config = createConfig();
  const logger = createLogger({
    consoleLevel: config.logLevel,
    discordLevel: config.discordLogLevel,
  }).child({ subsystem: 'register-commands' });
  await registerGuildCommands(config);
  logger.info('Registered guild commands', { guildId: config.env.DISCORD_GUILD_ID });
}

main().catch((error) => {
  createLogger({ consoleLevel: 'debug', discordLevel: 'error' }).error('Command registration failed', error, {
    subsystem: 'register-commands',
  });
  process.exit(1);
});
