import { eq } from 'drizzle-orm';

import { obsidianSyncState } from './schema';
import type { Database } from './types';

const DEFAULT_SYNC_KEY = 'default';

export class ObsidianSyncStateRepository {
  constructor(private readonly db: Database) {}

  async getState() {
    return this.db.query.obsidianSyncState.findFirst({
      where: eq(obsidianSyncState.syncKey, DEFAULT_SYNC_KEY),
    });
  }

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

  async updateIncrementalSync(input: { nextSyncToken: string }) {
    const now = new Date().toISOString();

    await this.db
      .insert(obsidianSyncState)
      .values({
        syncKey: DEFAULT_SYNC_KEY,
        lastIncrementalCursor: input.nextSyncToken,
        lastIncrementalSyncAtUtc: now,
        updatedAtUtc: now,
      })
      .onConflictDoUpdate({
        target: obsidianSyncState.syncKey,
        set: {
          lastIncrementalCursor: input.nextSyncToken,
          lastIncrementalSyncAtUtc: now,
          updatedAtUtc: now,
        },
      });
  }

  async deleteAll() {
    await this.db.delete(obsidianSyncState);
  }
}
