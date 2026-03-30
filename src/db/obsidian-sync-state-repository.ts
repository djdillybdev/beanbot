import { eq } from 'drizzle-orm';

import { obsidianSyncState } from './schema';
import type { Database } from './types';

const DEFAULT_SYNC_KEY = 'default';

export class ObsidianSyncStateRepository {
  constructor(private readonly db: Database) {}

  async touchFullSync() {
    const now = new Date().toISOString();

    await this.db
      .insert(obsidianSyncState)
      .values({
        syncKey: DEFAULT_SYNC_KEY,
        lastFullSyncAtUtc: now,
        updatedAtUtc: now,
      })
      .onConflictDoUpdate({
        target: obsidianSyncState.syncKey,
        set: {
          lastFullSyncAtUtc: now,
          updatedAtUtc: now,
        },
      });
  }

  async touchVaultScan() {
    const now = new Date().toISOString();

    await this.db
      .insert(obsidianSyncState)
      .values({
        syncKey: DEFAULT_SYNC_KEY,
        lastVaultScanAtUtc: now,
        updatedAtUtc: now,
      })
      .onConflictDoUpdate({
        target: obsidianSyncState.syncKey,
        set: {
          lastVaultScanAtUtc: now,
          updatedAtUtc: now,
        },
      });
  }
}
