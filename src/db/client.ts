import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';

import type { AppConfig } from '../config';
import * as schema from './schema';

export function createDb(config: AppConfig) {
  const sqlite = new Database(config.databasePath, { create: true });

  return drizzle(sqlite, { schema });
}
