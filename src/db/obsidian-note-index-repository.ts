import { eq } from 'drizzle-orm';

import { obsidianNoteIndex } from './schema';
import type { Database } from './types';

export class ObsidianNoteIndexRepository {
  constructor(private readonly db: Database) {}

  async listAll() {
    return this.db.query.obsidianNoteIndex.findMany({
      limit: 10000,
    });
  }

  async findByTaskId(todoistTaskId: string) {
    return this.db.query.obsidianNoteIndex.findFirst({
      where: eq(obsidianNoteIndex.todoistTaskId, todoistTaskId),
    });
  }

  async upsert(input: {
    todoistTaskId: string;
    filePath: string;
    contentHash: string;
    metadataHash: string;
    lastFileMtimeUtc?: string;
  }) {
    const now = new Date().toISOString();

    await this.db
      .insert(obsidianNoteIndex)
      .values({
        todoistTaskId: input.todoistTaskId,
        filePath: input.filePath,
        contentHash: input.contentHash,
        metadataHash: input.metadataHash,
        lastFileMtimeUtc: input.lastFileMtimeUtc ?? null,
        lastExportedAtUtc: now,
      })
      .onConflictDoUpdate({
        target: obsidianNoteIndex.todoistTaskId,
        set: {
          filePath: input.filePath,
          contentHash: input.contentHash,
          metadataHash: input.metadataHash,
          lastFileMtimeUtc: input.lastFileMtimeUtc ?? null,
          lastExportedAtUtc: now,
        },
      });
  }

  async markImported(input: {
    todoistTaskId: string;
    contentHash: string;
    lastFileMtimeUtc?: string;
  }) {
    await this.db
      .update(obsidianNoteIndex)
      .set({
        contentHash: input.contentHash,
        lastFileMtimeUtc: input.lastFileMtimeUtc ?? null,
        lastImportedAtUtc: new Date().toISOString(),
      })
      .where(eq(obsidianNoteIndex.todoistTaskId, input.todoistTaskId));
  }

  async updateFilePath(input: {
    todoistTaskId: string;
    filePath: string;
    lastFileMtimeUtc?: string;
  }) {
    await this.db
      .update(obsidianNoteIndex)
      .set({
        filePath: input.filePath,
        lastFileMtimeUtc: input.lastFileMtimeUtc ?? null,
      })
      .where(eq(obsidianNoteIndex.todoistTaskId, input.todoistTaskId));
  }

  async deleteByTaskId(todoistTaskId: string) {
    await this.db.delete(obsidianNoteIndex).where(eq(obsidianNoteIndex.todoistTaskId, todoistTaskId));
  }
}
