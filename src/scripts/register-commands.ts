import { createConfig } from '../config';
import { registerGuildCommands } from '../bot/register-commands';

async function main() {
  const config = createConfig();
  await registerGuildCommands(config);
  console.info(`Registered guild commands for ${config.env.DISCORD_GUILD_ID}`);
}

main().catch((error) => {
  console.error('Command registration failed', error);
  process.exit(1);
});
