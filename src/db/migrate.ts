import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';

import type { AppConfig } from '../config';

export function runMigrations(config: AppConfig) {
  const sqlite = new Database(config.databasePath, { create: true });
  const db = drizzle(sqlite);
  migrate(db, {
    migrationsFolder: './drizzle',
  });
  sqlite.close();
}
