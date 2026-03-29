import { createConfig } from '../config';
import { runMigrations } from '../db/migrate';
import { createLogger } from '../logging/logger';

try {
  const config = createConfig();
  const logger = createLogger({
    consoleLevel: config.logLevel,
    discordLevel: config.discordLogLevel,
  }).child({ subsystem: 'migrate' });
  runMigrations(config);
  logger.info('Migrations applied', { databasePath: config.databasePath });
} catch (error) {
  createLogger({ consoleLevel: 'debug', discordLevel: 'error' }).error('Migration failed', error, {
    subsystem: 'migrate',
  });
  process.exit(1);
}
