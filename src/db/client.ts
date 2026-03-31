import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';

import type { AppConfig } from '../config';
import * as schema from './schema';

interface CreateDbOptions {
  readonly?: boolean;
}

export function createDb(config: AppConfig, options: CreateDbOptions = {}) {
  const sqlite = new Database(config.databasePath, {
    create: !options.readonly,
    readonly: options.readonly,
  });

  return drizzle(sqlite, { schema });
}
