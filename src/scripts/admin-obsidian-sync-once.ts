import { createConfig } from '../config';
import { createDb } from '../db/client';
import { OAuthTokenRepository } from '../db/oauth-token-repository';
import { TodoistClient } from '../integrations/todoist/client';
import { createLogger } from '../logging/logger';
import { createObsidianSyncContext } from '../app/obsidian/obsidian-sync-context';

async function main() {
  const config = createConfig();

  if (!config.obsidianVaultPath) {
    throw new Error('OBSIDIAN_VAULT_PATH must be configured before running admin:obsidian:sync-once.');
  }

  const db = createDb(config);
  const tokenRepository = new OAuthTokenRepository(db);
  const todoistClient = new TodoistClient(config, tokenRepository);
  const logger = createLogger({
    consoleLevel: config.logLevel,
    discordLevel: config.discordLogLevel,
  }).child({ subsystem: 'admin-obsidian-sync-once' });

  const { syncService, syncStateRepository } = createObsidianSyncContext(
    config,
    db,
    todoistClient,
    logger,
  );

  await syncService.runOnce();
  const state = await syncStateRepository.getState();

  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    result: 'success',
    state,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
