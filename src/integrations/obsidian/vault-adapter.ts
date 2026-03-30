import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';

import type { Logger } from '../../logging/logger';
import type { ObsidianExportTask } from '../../db/obsidian-task-repository';

interface ExportResult {
  filePath: string;
  relativePath: string;
  contentHash: string;
  metadataHash: string;
  lastFileMtimeUtc: string;
  noteBody: string;
  didWrite: boolean;
}

export class ObsidianVaultAdapter {
  constructor(
    private readonly vaultPath: string,
    private readonly tasksPath: string,
    private readonly logger: Logger,
  ) {}

  async exportTask(task: ObsidianExportTask, previousRelativePath?: string | null): Promise<ExportResult> {
    const filePath = await this.resolveFilePath(task, previousRelativePath);
    await mkdir(dirname(filePath), { recursive: true });

    const existingBody = await this.readExistingBody(filePath);
    const noteBody = task.noteBody ?? existingBody ?? '';
    const metadataHash = hashString(buildMetadataHashSource(task));
    const content = buildMarkdown(task, metadataHash, noteBody);
    const contentHash = hashString(content);
    const currentFile = await this.safeReadFile(filePath);

    let didWrite = false;
    if (currentFile !== content) {
      const tempFilePath = `${filePath}.tmp`;
      await writeFile(tempFilePath, content, 'utf8');
      await rename(tempFilePath, filePath);
      didWrite = true;
    }

    const fileStat = await stat(filePath);

    this.logger.debug('Exported Obsidian task note', {
      todoistTaskId: task.todoistTaskId,
      didWrite,
      relativePath: relative(this.vaultPath, filePath),
    });

    return {
      filePath,
      relativePath: relative(this.vaultPath, filePath),
      contentHash,
      metadataHash,
      lastFileMtimeUtc: fileStat.mtime.toISOString(),
      noteBody,
      didWrite,
    };
  }

  private async resolveFilePath(task: ObsidianExportTask, previousRelativePath?: string | null) {
    const desiredFileName = `${task.todoistTaskId}.md`;
    const desiredPath = join(this.vaultPath, this.tasksPath, desiredFileName);
    const previousPath = previousRelativePath ? join(this.vaultPath, previousRelativePath) : null;
    const legacyTitlePath = join(this.vaultPath, this.tasksPath, `${sanitizeFileName(task.content)}.md`);

    if (!(await this.pathExists(desiredPath))) {
      const migrationSource =
        (previousPath && previousPath !== desiredPath && (await this.pathExists(previousPath)) ? previousPath : null) ??
        (legacyTitlePath !== desiredPath && (await this.pathExists(legacyTitlePath)) ? legacyTitlePath : null);

      if (migrationSource) {
        await mkdir(dirname(desiredPath), { recursive: true });
        await rename(migrationSource, desiredPath);
        return desiredPath;
      }

      return desiredPath;
    }

    if (previousPath === desiredPath) {
      return desiredPath;
    }

    return desiredPath;
  }

  private async readExistingBody(filePath: string) {
    const content = await this.safeReadFile(filePath);

    if (content === null) {
      return null;
    }

    const match = content.match(/^---\n[\s\S]*?\n---\n?([\s\S]*)$/);
    return match ? match[1] : content;
  }

  private async safeReadFile(filePath: string) {
    try {
      return await readFile(filePath, 'utf8');
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return null;
      }

      throw error;
    }
  }

  private async pathExists(filePath: string) {
    try {
      await stat(filePath);
      return true;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return false;
      }

      throw error;
    }
  }
}

function buildMarkdown(task: ObsidianExportTask, metadataHash: string, noteBody: string) {
  const frontmatterLines = [
    '---',
    serializeYamlField('todoist_id', task.todoistTaskId),
    serializeYamlField('title', task.content),
    serializeYamlField('aliases', [task.content]),
    serializeYamlField('completed', task.completed),
    serializeYamlField('priority_api', task.priorityApi),
    serializeYamlField('project', task.project ?? null),
    serializeYamlField('labels', task.labels),
    serializeYamlField('due_date', task.dueDate ?? null),
    serializeYamlField('due_datetime', task.dueDatetimeUtc ?? null),
    serializeYamlField('recurring', task.recurring),
    serializeYamlField('parent_id', task.parentId ?? null),
    serializeYamlField('order_index', task.orderIndex ?? null),
    serializeYamlField('todoist_project_id', task.todoistProjectId ?? null),
    serializeYamlField('todoist_project_name', task.todoistProjectName ?? null),
    serializeYamlField('section_id', task.sectionId ?? null),
    serializeYamlField('section_name', task.sectionName ?? null),
    serializeYamlField('todoist_url', task.todoistUrl),
    serializeYamlField('created_at', task.createdAtUtc ?? null),
    serializeYamlField('updated_at', task.updatedAtUtc ?? null),
    serializeYamlField('last_synced_at', task.lastSyncedAtUtc),
    serializeYamlField('sync_status', task.syncStatus),
    serializeYamlField('source_of_last_change', task.sourceOfLastChange),
    serializeYamlField('content_hash', metadataHash),
    '---',
    '',
  ];

  return `${frontmatterLines.join('\n')}${normalizeBody(noteBody)}`;
}

function buildMetadataHashSource(task: ObsidianExportTask) {
  return JSON.stringify({
    todoistId: task.todoistTaskId,
    content: task.content,
    completed: task.completed,
    priorityApi: task.priorityApi,
    project: task.project ?? null,
    labels: task.labels,
    dueDate: task.dueDate ?? null,
    dueDatetimeUtc: task.dueDatetimeUtc ?? null,
    recurring: task.recurring,
    parentId: task.parentId ?? null,
    orderIndex: task.orderIndex ?? null,
    todoistProjectId: task.todoistProjectId ?? null,
    todoistProjectName: task.todoistProjectName ?? null,
    sectionId: task.sectionId ?? null,
    sectionName: task.sectionName ?? null,
    todoistUrl: task.todoistUrl,
    createdAtUtc: task.createdAtUtc ?? null,
    updatedAtUtc: task.updatedAtUtc ?? null,
    lastSyncedAtUtc: task.lastSyncedAtUtc,
    syncStatus: task.syncStatus,
    sourceOfLastChange: task.sourceOfLastChange,
  });
}

function serializeYamlField(name: string, value: boolean | number | string | string[] | null) {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return `${name}: []`;
    }

    return `${name}:\n${value.map((item) => `  - ${quoteYamlString(item)}`).join('\n')}`;
  }

  if (typeof value === 'boolean' || typeof value === 'number') {
    return `${name}: ${String(value)}`;
  }

  if (value === null) {
    return `${name}: null`;
  }

  return `${name}: ${quoteYamlString(value)}`;
}

function quoteYamlString(value: string) {
  return JSON.stringify(value);
}

function normalizeBody(body: string) {
  if (body.length === 0) {
    return '';
  }

  return body.endsWith('\n') ? body : `${body}\n`;
}

function hashString(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function sanitizeFileName(value: string) {
  const sanitized = value
    .replace(/[\/\\:*?"<>|]/g, ' ')
    .replace(/[\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');

  return sanitized.length > 0 ? sanitized : 'Untitled Task';
}
