import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

import type { AppConfig } from '../../config';
import { ObsidianNoteIndexRepository } from '../../db/obsidian-note-index-repository';
import type { ObsidianLocalCandidate, ObsidianTaskRepository } from '../../db/obsidian-task-repository';
import { ObsidianSyncEventRepository } from '../../db/obsidian-sync-event-repository';
import { ObsidianSyncStateRepository } from '../../db/obsidian-sync-state-repository';
import { parseObsidianTaskNote, parseWritableFields } from '../../integrations/obsidian/frontmatter';
import type { Logger } from '../../logging/logger';
import { ObsidianLocalCreateService } from './obsidian-local-create-service';
import { parseEffortList } from './project-labels';

export class ObsidianLocalScanService {
  constructor(
    private readonly config: AppConfig,
    private readonly noteIndexRepository: ObsidianNoteIndexRepository,
    private readonly taskRepository: ObsidianTaskRepository,
    private readonly syncEventRepository: ObsidianSyncEventRepository,
    private readonly syncStateRepository: ObsidianSyncStateRepository,
    private readonly localCreateService: ObsidianLocalCreateService,
    private readonly logger: Logger,
  ) {}

  async scan() {
    const noteIndexes = await this.noteIndexRepository.listAll();
    let changedFileCount = 0;
    let detectedDeleteCount = 0;
    let conflictCount = 0;
    let errorCount = 0;
    const taskFiles = await listMarkdownTaskFiles(this.config.obsidianVaultPath!, this.config.obsidianTasksPath);
    const resolvedKnownPaths = new Set<string>();

    for (const noteIndex of noteIndexes) {
      const task = await this.taskRepository.getByTaskId(noteIndex.todoistTaskId);

      if (!task || task.taskStatus === 'deleted') {
        continue;
      }

      const resolvedNote = await this.resolveTrackedNote(noteIndex.todoistTaskId, noteIndex.filePath, taskFiles);

      if (resolvedNote.status === 'missing') {
        await this.taskRepository.markPendingDelete(noteIndex.todoistTaskId);
        await this.syncEventRepository.insert({
          eventType: 'local_delete_detected',
          source: 'obsidian',
          todoistTaskId: noteIndex.todoistTaskId,
          payloadSummary: JSON.stringify({
            filePath: noteIndex.filePath,
            title: task.content,
          }),
          result: 'pending_delete',
        });
        this.logger.warn('Detected local deletion for synced note', {
          todoistTaskId: noteIndex.todoistTaskId,
          filePath: noteIndex.filePath,
          title: task.content,
        });
        detectedDeleteCount += 1;
        continue;
      }

      if (resolvedNote.status === 'conflict') {
        await this.taskRepository.markConflict(noteIndex.todoistTaskId);
        await this.syncEventRepository.insert({
          eventType: 'local_note_duplicate_identity',
          source: 'obsidian',
          todoistTaskId: noteIndex.todoistTaskId,
          payloadSummary: JSON.stringify({
            indexedPath: noteIndex.filePath,
            matchedPaths: resolvedNote.matches,
          }),
          result: 'conflict',
        });
        this.logger.warn('Detected Obsidian note identity conflict', {
          todoistTaskId: noteIndex.todoistTaskId,
          indexedPath: noteIndex.filePath,
          matchedPaths: resolvedNote.matches,
        });
        conflictCount += 1;
        continue;
      }

      resolvedKnownPaths.add(resolvedNote.relativePath);

      if (resolvedNote.relativePath !== noteIndex.filePath) {
        await this.noteIndexRepository.updateFilePath({
          todoistTaskId: noteIndex.todoistTaskId,
          filePath: resolvedNote.relativePath,
          lastFileMtimeUtc: resolvedNote.fileStat.mtime.toISOString(),
        });
        await this.syncEventRepository.insert({
          eventType: 'local_rename_repaired',
          source: 'obsidian',
          todoistTaskId: noteIndex.todoistTaskId,
          payloadSummary: JSON.stringify({
            from: noteIndex.filePath,
            to: resolvedNote.relativePath,
          }),
          result: 'repaired_on_export',
        });
      }

      const fileContent = resolvedNote.fileContent;
      const fileHash = hashString(fileContent);

      if (fileHash === noteIndex.contentHash) {
        continue;
      }

      changedFileCount += 1;
      const parsed = parseObsidianTaskNote(fileContent);

      try {
        const candidate = parseWritableFields(parsed.frontmatter);
        const effortValues = Array.isArray(parsed.frontmatter.effort)
          ? parsed.frontmatter.effort.filter((value): value is string => typeof value === 'string')
          : [];
        const effortParse = parseEffortList(effortValues);
        const diff = buildWritableDiff(task, candidate);

        if (effortParse.hadConflict) {
          await this.syncEventRepository.insert({
            eventType: 'local_effort_normalized',
            source: 'obsidian',
            todoistTaskId: noteIndex.todoistTaskId,
            payloadSummary: JSON.stringify({
              filePath: resolvedNote.relativePath,
              effort: effortValues,
              normalizedEffort: effortParse.effort ?? null,
            }),
            result: 'warning',
          });
          this.logger.warn('Normalized conflicting Obsidian effort values', {
            todoistTaskId: noteIndex.todoistTaskId,
            filePath: resolvedNote.relativePath,
            effort: effortValues,
            normalizedEffort: effortParse.effort ?? null,
          });
        }

        if (diff.length === 0) {
          await this.taskRepository.updateNoteBody(noteIndex.todoistTaskId, parsed.body);
          await this.noteIndexRepository.markImported({
            todoistTaskId: noteIndex.todoistTaskId,
            contentHash: fileHash,
            lastFileMtimeUtc: resolvedNote.fileStat.mtime.toISOString(),
          });
          continue;
        }

        await this.taskRepository.markPendingPush(noteIndex.todoistTaskId, candidate, parsed.body);
        await this.noteIndexRepository.markImported({
          todoistTaskId: noteIndex.todoistTaskId,
          contentHash: fileHash,
          lastFileMtimeUtc: resolvedNote.fileStat.mtime.toISOString(),
        });
        await this.syncEventRepository.insert({
          eventType: 'local_change_detected',
          source: 'obsidian',
          todoistTaskId: noteIndex.todoistTaskId,
          payloadSummary: JSON.stringify({
            filePath: resolvedNote.relativePath,
            changedFields: diff,
          }),
          result: 'pending_push',
        });
      } catch (error) {
        await this.taskRepository.markError(noteIndex.todoistTaskId, 'obsidian');
        await this.syncEventRepository.insert({
          eventType: 'local_change_invalid',
          source: 'obsidian',
          todoistTaskId: noteIndex.todoistTaskId,
          payloadSummary: JSON.stringify({
            filePath: resolvedNote.relativePath,
            error: error instanceof Error ? error.message : String(error),
          }),
          result: 'error',
        });
        this.logger.warn('Skipping invalid Obsidian local change', {
          todoistTaskId: noteIndex.todoistTaskId,
          filePath: resolvedNote.relativePath,
          error: error instanceof Error ? error.message : String(error),
        });
        errorCount += 1;
      }
    }

    const untrackedPaths = taskFiles.filter((relativePath) => !resolvedKnownPaths.has(relativePath));
    const createResult = await this.localCreateService.createFromUntrackedNotes(untrackedPaths);
    await this.syncStateRepository.touchVaultScan();

    return {
      changedFileCount,
      createdTaskCount: createResult.createdTaskCount,
      detectedDeleteCount,
      conflictCount,
      errorCount,
    };
  }

  private async resolveTrackedNote(todoistTaskId: string, indexedRelativePath: string, taskFiles: string[]) {
    const indexedAbsolutePath = join(this.config.obsidianVaultPath!, indexedRelativePath);

    try {
      const fileContent = await readFile(indexedAbsolutePath, 'utf8');
      const fileStat = await stat(indexedAbsolutePath);

      return {
        status: 'found' as const,
        relativePath: indexedRelativePath,
        fileContent,
        fileStat,
      };
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
        throw error;
      }
    }

    const matches: Array<{ relativePath: string; fileContent: string; fileStat: Awaited<ReturnType<typeof stat>> }> = [];

    for (const relativePath of taskFiles) {
      const absolutePath = join(this.config.obsidianVaultPath!, relativePath);
      const fileContent = await readFile(absolutePath, 'utf8');

      try {
        const parsed = parseObsidianTaskNote(fileContent);

        if (parsed.frontmatter.todoist_id !== todoistTaskId) {
          continue;
        }

        matches.push({
          relativePath,
          fileContent,
          fileStat: await stat(absolutePath),
        });
      } catch {
        continue;
      }
    }

    if (matches.length === 0) {
      return { status: 'missing' as const };
    }

    if (matches.length > 1) {
      return {
        status: 'conflict' as const,
        matches: matches.map((match) => match.relativePath),
      };
    }

    const match = matches[0];

    if (!match) {
      return { status: 'missing' as const };
    }

    return {
      status: 'found' as const,
      relativePath: match.relativePath,
      fileContent: match.fileContent,
      fileStat: match.fileStat,
    };
  }
}

function buildWritableDiff(
  task: {
    content: string;
    completed: boolean;
    priorityApi: number;
    project?: string;
    effort?: string;
    labels: string[];
    dueDate?: string;
    dueDatetimeUtc?: string;
  },
  candidate: ObsidianLocalCandidate,
) {
  const changedFields: string[] = [];

  if (task.content !== candidate.title) {
    changedFields.push('title');
  }
  if (task.completed !== candidate.completed) {
    changedFields.push('completed');
  }
  if (task.priorityApi !== candidate.priorityApi) {
    changedFields.push('priority_api');
  }
  if ((task.project ?? undefined) !== (candidate.project ?? undefined)) {
    changedFields.push('project');
  }
  if ((task.effort ?? undefined) !== (candidate.effort ?? undefined)) {
    changedFields.push('effort');
  }
  if (!sameStringList(task.labels, candidate.labels)) {
    changedFields.push('labels');
  }
  if ((task.dueDate ?? undefined) !== (candidate.dueDate ?? undefined)) {
    changedFields.push('due_date');
  }
  if ((task.dueDatetimeUtc ?? undefined) !== (candidate.dueDatetime ?? undefined)) {
    changedFields.push('due_datetime');
  }

  return changedFields;
}

function sameStringList(left: string[], right: string[]) {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}

function hashString(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

async function listMarkdownTaskFiles(vaultPath: string, tasksPath: string) {
  const taskDirectory = join(vaultPath, tasksPath);
  let entries: string[] = [];
  try {
    entries = await readdir(taskDirectory);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return [];
    }

    throw error;
  }

  return entries
    .filter((entry) => entry.endsWith('.md'))
    .map((entry) => join(tasksPath, entry));
}
