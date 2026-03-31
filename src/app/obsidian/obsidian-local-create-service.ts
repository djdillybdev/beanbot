import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import type { AppConfig } from '../../config';
import { ObsidianNoteIndexRepository } from '../../db/obsidian-note-index-repository';
import { ObsidianSyncEventRepository } from '../../db/obsidian-sync-event-repository';
import type { ObsidianTaskRepository } from '../../db/obsidian-task-repository';
import { parseObsidianTaskNote, parseWritableFields } from '../../integrations/obsidian/frontmatter';
import { TodoistClient } from '../../integrations/todoist/client';
import type { Logger } from '../../logging/logger';
import { mergeReservedLabels, parseEffortList } from './project-labels';

export class ObsidianLocalCreateService {
  constructor(
    private readonly config: AppConfig,
    private readonly todoistClient: TodoistClient,
    private readonly taskRepository: ObsidianTaskRepository,
    private readonly noteIndexRepository: ObsidianNoteIndexRepository,
    private readonly syncEventRepository: ObsidianSyncEventRepository,
    private readonly logger: Logger,
  ) {}

  async createFromUntrackedNotes(notePaths: string[]) {
    let createdTaskCount = 0;

    for (const relativePath of notePaths) {
      const absolutePath = join(this.config.obsidianVaultPath!, relativePath);
      const fileContent = await readFile(absolutePath, 'utf8');

      try {
        const parsed = parseObsidianTaskNote(fileContent);

        if (typeof parsed.frontmatter.todoist_id === 'string' && parsed.frontmatter.todoist_id.length > 0) {
          await this.syncEventRepository.insert({
            eventType: 'local_note_untracked_existing_id',
            source: 'obsidian',
            todoistTaskId: parsed.frontmatter.todoist_id,
            payloadSummary: relativePath,
            result: 'ignored',
          });
          continue;
        }

        const candidate = parseWritableFields(parsed.frontmatter);
        const effortValues = Array.isArray(parsed.frontmatter.effort)
          ? parsed.frontmatter.effort.filter((value): value is string => typeof value === 'string')
          : [];
        const effortParse = parseEffortList(effortValues);

        if (effortParse.hadConflict) {
          await this.syncEventRepository.insert({
            eventType: 'local_effort_normalized',
            source: 'obsidian',
            payloadSummary: JSON.stringify({
              filePath: relativePath,
              effort: effortValues,
              normalizedEffort: effortParse.effort ?? null,
            }),
            result: 'warning',
          });
          this.logger.warn('Normalized conflicting Obsidian effort values on create', {
            filePath: relativePath,
            effort: effortValues,
            normalizedEffort: effortParse.effort ?? null,
          });
        }

        const labels = mergeReservedLabels(candidate.project, candidate.effort, candidate.labels);
        const createdTask = await this.todoistClient.createTask({
          content: candidate.title,
          priority: normalizePriority(candidate.priorityApi),
          labels,
          dueDate: candidate.dueDatetime ? undefined : candidate.dueDate,
          dueDatetime: candidate.dueDatetime,
        });

        if (candidate.completed) {
          await this.todoistClient.closeTask(createdTask.id);
        }

        await this.taskRepository.upsertFromTodoist(
          {
            ...createdTask,
            labels,
            taskStatus: candidate.completed ? 'completed' : 'active',
          },
          { preservePendingPush: false },
        );

        if (candidate.completed) {
          await this.taskRepository.markSyncedAfterPush(
            {
              todoistTaskId: createdTask.id,
              content: candidate.title,
              completed: true,
              priorityApi: candidate.priorityApi,
              project: candidate.project,
              effort: candidate.effort,
              labels: candidate.labels,
              dueDate: candidate.dueDate,
              dueDatetimeUtc: candidate.dueDatetime,
              recurring: createdTask.recurring ?? false,
              parentId: createdTask.parentId,
              orderIndex: createdTask.orderIndex,
              todoistProjectId: createdTask.projectId,
              todoistProjectName: createdTask.projectName,
              sectionId: createdTask.sectionId,
              todoistUrl: createdTask.url,
              createdAtUtc: createdTask.createdAtUtc,
              updatedAtUtc: createdTask.updatedAtUtc,
              lastSyncedAtUtc: new Date().toISOString(),
              syncStatus: 'synced',
              sourceOfLastChange: 'obsidian',
              noteBody: parsed.body,
              taskStatus: 'active',
            },
            candidate.labels,
            createdTask.url,
          );
        } else {
          await this.taskRepository.updateNoteBody(createdTask.id, parsed.body);
        }

        const fileStat = await stat(absolutePath);
        await this.noteIndexRepository.upsert({
          todoistTaskId: createdTask.id,
          filePath: relativePath,
          contentHash: '',
          metadataHash: '',
          lastFileMtimeUtc: fileStat.mtime.toISOString(),
        });
        await this.syncEventRepository.insert({
          eventType: 'local_note_created',
          source: 'obsidian',
          todoistTaskId: createdTask.id,
          payloadSummary: JSON.stringify({
            filePath: relativePath,
            completed: candidate.completed,
          }),
          result: 'created',
        });
        createdTaskCount += 1;
      } catch (error) {
        await this.syncEventRepository.insert({
          eventType: 'local_note_create_invalid',
          source: 'obsidian',
          payloadSummary: JSON.stringify({
            filePath: relativePath,
            error: error instanceof Error ? error.message : String(error),
          }),
          result: 'error',
        });
        this.logger.warn('Invalid untracked Obsidian task note failed creation validation', {
          filePath: relativePath,
          error: error instanceof Error ? error.message : String(error),
        });
        this.logger.warn('Skipping invalid untracked Obsidian task note', {
          filePath: relativePath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return { createdTaskCount };
  }
}

function normalizePriority(priority: number): 1 | 2 | 3 | 4 {
  if (priority >= 4) {
    return 4;
  }

  if (priority <= 1) {
    return 1;
  }

  return priority as 1 | 2 | 3 | 4;
}
