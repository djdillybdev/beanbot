import { createConfig } from '../config';
import { runMigrations } from '../db/migrate';

try {
  const config = createConfig();
  runMigrations(config);
  console.info(`Migrations applied to ${config.databasePath}`);
} catch (error) {
  console.error('Migration failed', error);
  process.exit(1);
}
