import { and, eq, inArray } from 'drizzle-orm';

import { obsidianTask, obsidianTaskLabel } from './schema';
import type { Database } from './types';
import type { TodoistTaskRecord } from '../domain/task';

export interface ObsidianExportTask {
  todoistTaskId: string;
  content: string;
  completed: boolean;
  priorityApi: number;
  project?: string;
  labels: string[];
  dueDate?: string;
  dueDatetimeUtc?: string;
  recurring: boolean;
  parentId?: string;
  orderIndex?: number;
  todoistProjectId?: string;
  todoistProjectName?: string;
  sectionId?: string;
  sectionName?: string;
  todoistUrl: string;
  createdAtUtc?: string;
  updatedAtUtc?: string;
  lastSyncedAtUtc: string;
  syncStatus: string;
  sourceOfLastChange: string;
  contentHash?: string;
  noteBody?: string;
  taskStatus: string;
}

export interface ObsidianLocalCandidate {
  title: string;
  completed: boolean;
  priorityApi: number;
  project?: string;
  labels: string[];
  dueDate?: string;
  dueDatetime?: string;
}

export class ObsidianTaskRepository {
  constructor(private readonly db: Database) {}

  async upsertFromTodoist(task: TodoistTaskRecord, options?: { preservePendingPush?: boolean }) {
    const now = new Date().toISOString();
    const { project, labels } = splitProjectLabel(task.labels);
    const existing = await this.db.query.obsidianTask.findFirst({
      where: eq(obsidianTask.todoistTaskId, task.id),
    });

    if (
      options?.preservePendingPush !== false &&
      existing &&
      ['pending_push', 'pending_delete', 'conflict', 'error'].includes(existing.syncStatus)
    ) {
      return;
    }

    await this.db
      .insert(obsidianTask)
      .values({
        todoistTaskId: task.id,
        content: task.title,
        completed: task.taskStatus === 'completed',
        priorityApi: task.priority,
        project,
        todoistProjectId: task.projectId ?? null,
        todoistProjectName: task.projectName ?? null,
        sectionId: task.sectionId ?? null,
        sectionName: null,
        dueDate: task.dueDate ?? null,
        dueDatetimeUtc: task.dueDateTimeUtc ?? null,
        recurring: task.recurring ?? false,
        parentId: task.parentId ?? null,
        orderIndex: task.orderIndex ?? null,
        todoistUrl: task.url,
        createdAtUtc: task.createdAtUtc ?? now,
        sourceUpdatedAtUtc: task.updatedAtUtc ?? task.createdAtUtc ?? now,
        dbUpdatedAtUtc: now,
        lastSyncedAtUtc: now,
        syncStatus: 'synced',
        sourceOfLastChange: 'todoist',
        taskStatus: task.taskStatus,
      })
      .onConflictDoUpdate({
        target: obsidianTask.todoistTaskId,
        set: {
          content: task.title,
          completed: task.taskStatus === 'completed',
          priorityApi: task.priority,
          project,
          todoistProjectId: task.projectId ?? null,
          todoistProjectName: task.projectName ?? null,
          sectionId: task.sectionId ?? null,
          dueDate: task.dueDate ?? null,
          dueDatetimeUtc: task.dueDateTimeUtc ?? null,
          recurring: task.recurring ?? false,
          parentId: task.parentId ?? null,
          orderIndex: task.orderIndex ?? null,
          todoistUrl: task.url,
          sourceUpdatedAtUtc: task.updatedAtUtc ?? task.createdAtUtc ?? now,
          dbUpdatedAtUtc: now,
          lastSyncedAtUtc: now,
          syncStatus: 'synced',
          sourceOfLastChange: 'todoist',
          taskStatus: task.taskStatus,
        },
      });

    await this.db.delete(obsidianTaskLabel).where(eq(obsidianTaskLabel.todoistTaskId, task.id));

    if (labels.length > 0) {
      await this.db.insert(obsidianTaskLabel).values(
        labels.map((label) => ({
          todoistTaskId: task.id,
          labelName: label,
        })),
      );
    }
  }

  async listActiveForExport(): Promise<ObsidianExportTask[]> {
    const tasks = await this.db.query.obsidianTask.findMany({
      where: and(eq(obsidianTask.taskStatus, 'active'), eq(obsidianTask.syncStatus, 'synced')),
      limit: 5000,
    });

    if (tasks.length === 0) {
      return [];
    }

    const taskIds = tasks.map((task) => task.todoistTaskId);
    const labels = await this.db.query.obsidianTaskLabel.findMany({
      where: inArray(obsidianTaskLabel.todoistTaskId, taskIds),
      limit: 10000,
    });

    const labelsByTaskId = new Map<string, string[]>();

    for (const label of labels) {
      const current = labelsByTaskId.get(label.todoistTaskId) ?? [];
      current.push(label.labelName);
      labelsByTaskId.set(label.todoistTaskId, current);
    }

    return tasks.map((task) => ({
      todoistTaskId: task.todoistTaskId,
      content: task.content,
      completed: task.completed,
      priorityApi: task.priorityApi,
      project: task.project ?? undefined,
      labels: (labelsByTaskId.get(task.todoistTaskId) ?? []).sort((left, right) => left.localeCompare(right)),
      dueDate: task.dueDate ?? undefined,
      dueDatetimeUtc: task.dueDatetimeUtc ?? undefined,
      recurring: task.recurring,
      parentId: task.parentId ?? undefined,
      orderIndex: task.orderIndex ?? undefined,
      todoistProjectId: task.todoistProjectId ?? undefined,
      todoistProjectName: task.todoistProjectName ?? undefined,
      sectionId: task.sectionId ?? undefined,
      sectionName: task.sectionName ?? undefined,
      todoistUrl: task.todoistUrl,
      createdAtUtc: task.createdAtUtc ?? undefined,
      updatedAtUtc: task.sourceUpdatedAtUtc ?? undefined,
      lastSyncedAtUtc: task.lastSyncedAtUtc,
      syncStatus: task.syncStatus,
      sourceOfLastChange: task.sourceOfLastChange,
      contentHash: task.contentHash ?? undefined,
      noteBody: task.noteBody ?? undefined,
      taskStatus: task.taskStatus,
    }));
  }

  async updateExportMetadata(todoistTaskId: string, input: { contentHash: string; noteBody?: string }) {
    await this.db
      .update(obsidianTask)
      .set({
        contentHash: input.contentHash,
        noteBody: input.noteBody ?? null,
        dbUpdatedAtUtc: new Date().toISOString(),
      })
      .where(and(eq(obsidianTask.todoistTaskId, todoistTaskId), eq(obsidianTask.taskStatus, 'active')));
  }

  async listPendingPush(): Promise<ObsidianExportTask[]> {
    const tasks = await this.db.query.obsidianTask.findMany({
      where: eq(obsidianTask.syncStatus, 'pending_push'),
      limit: 5000,
    });

    if (tasks.length === 0) {
      return [];
    }

    const taskIds = tasks.map((task) => task.todoistTaskId);
    const labels = await this.db.query.obsidianTaskLabel.findMany({
      where: inArray(obsidianTaskLabel.todoistTaskId, taskIds),
      limit: 10000,
    });

    const labelsByTaskId = new Map<string, string[]>();

    for (const label of labels) {
      const current = labelsByTaskId.get(label.todoistTaskId) ?? [];
      current.push(label.labelName);
      labelsByTaskId.set(label.todoistTaskId, current);
    }

    return tasks.map((task) => ({
      todoistTaskId: task.todoistTaskId,
      content: task.content,
      completed: task.completed,
      priorityApi: task.priorityApi,
      project: task.project ?? undefined,
      labels: (labelsByTaskId.get(task.todoistTaskId) ?? []).sort((left, right) => left.localeCompare(right)),
      dueDate: task.dueDate ?? undefined,
      dueDatetimeUtc: task.dueDatetimeUtc ?? undefined,
      recurring: task.recurring,
      parentId: task.parentId ?? undefined,
      orderIndex: task.orderIndex ?? undefined,
      todoistProjectId: task.todoistProjectId ?? undefined,
      todoistProjectName: task.todoistProjectName ?? undefined,
      sectionId: task.sectionId ?? undefined,
      sectionName: task.sectionName ?? undefined,
      todoistUrl: task.todoistUrl,
      createdAtUtc: task.createdAtUtc ?? undefined,
      updatedAtUtc: task.sourceUpdatedAtUtc ?? undefined,
      lastSyncedAtUtc: task.lastSyncedAtUtc,
      syncStatus: task.syncStatus,
      sourceOfLastChange: task.sourceOfLastChange,
      contentHash: task.contentHash ?? undefined,
      noteBody: task.noteBody ?? undefined,
      taskStatus: task.taskStatus,
    }));
  }

  async listPendingDelete(): Promise<ObsidianExportTask[]> {
    const tasks = await this.db.query.obsidianTask.findMany({
      where: eq(obsidianTask.syncStatus, 'pending_delete'),
      limit: 5000,
    });

    if (tasks.length === 0) {
      return [];
    }

    const taskIds = tasks.map((task) => task.todoistTaskId);
    const labels = await this.db.query.obsidianTaskLabel.findMany({
      where: inArray(obsidianTaskLabel.todoistTaskId, taskIds),
      limit: 10000,
    });

    const labelsByTaskId = new Map<string, string[]>();

    for (const label of labels) {
      const current = labelsByTaskId.get(label.todoistTaskId) ?? [];
      current.push(label.labelName);
      labelsByTaskId.set(label.todoistTaskId, current);
    }

    return tasks.map((task) => ({
      todoistTaskId: task.todoistTaskId,
      content: task.content,
      completed: task.completed,
      priorityApi: task.priorityApi,
      project: task.project ?? undefined,
      labels: (labelsByTaskId.get(task.todoistTaskId) ?? []).sort((left, right) => left.localeCompare(right)),
      dueDate: task.dueDate ?? undefined,
      dueDatetimeUtc: task.dueDatetimeUtc ?? undefined,
      recurring: task.recurring,
      parentId: task.parentId ?? undefined,
      orderIndex: task.orderIndex ?? undefined,
      todoistProjectId: task.todoistProjectId ?? undefined,
      todoistProjectName: task.todoistProjectName ?? undefined,
      sectionId: task.sectionId ?? undefined,
      sectionName: task.sectionName ?? undefined,
      todoistUrl: task.todoistUrl,
      createdAtUtc: task.createdAtUtc ?? undefined,
      updatedAtUtc: task.sourceUpdatedAtUtc ?? undefined,
      lastSyncedAtUtc: task.lastSyncedAtUtc,
      syncStatus: task.syncStatus,
      sourceOfLastChange: task.sourceOfLastChange,
      contentHash: task.contentHash ?? undefined,
      noteBody: task.noteBody ?? undefined,
      taskStatus: task.taskStatus,
    }));
  }

  async getByTaskId(todoistTaskId: string): Promise<ObsidianExportTask | null> {
    const task = await this.db.query.obsidianTask.findFirst({
      where: eq(obsidianTask.todoistTaskId, todoistTaskId),
    });

    if (!task) {
      return null;
    }

    const labels = await this.db.query.obsidianTaskLabel.findMany({
      where: eq(obsidianTaskLabel.todoistTaskId, todoistTaskId),
      limit: 500,
    });

    return {
      todoistTaskId: task.todoistTaskId,
      content: task.content,
      completed: task.completed,
      priorityApi: task.priorityApi,
      project: task.project ?? undefined,
      labels: labels.map((label) => label.labelName).sort((left, right) => left.localeCompare(right)),
      dueDate: task.dueDate ?? undefined,
      dueDatetimeUtc: task.dueDatetimeUtc ?? undefined,
      recurring: task.recurring,
      parentId: task.parentId ?? undefined,
      orderIndex: task.orderIndex ?? undefined,
      todoistProjectId: task.todoistProjectId ?? undefined,
      todoistProjectName: task.todoistProjectName ?? undefined,
      sectionId: task.sectionId ?? undefined,
      sectionName: task.sectionName ?? undefined,
      todoistUrl: task.todoistUrl,
      createdAtUtc: task.createdAtUtc ?? undefined,
      updatedAtUtc: task.sourceUpdatedAtUtc ?? undefined,
      lastSyncedAtUtc: task.lastSyncedAtUtc,
      syncStatus: task.syncStatus,
      sourceOfLastChange: task.sourceOfLastChange,
      contentHash: task.contentHash ?? undefined,
      noteBody: task.noteBody ?? undefined,
      taskStatus: task.taskStatus,
    };
  }

  async markPendingPush(todoistTaskId: string, candidate: ObsidianLocalCandidate, noteBody: string) {
    const now = new Date().toISOString();

    await this.db
      .update(obsidianTask)
      .set({
        content: candidate.title,
        completed: candidate.completed,
        priorityApi: candidate.priorityApi,
        project: candidate.project ?? null,
        dueDate: candidate.dueDate ?? null,
        dueDatetimeUtc: candidate.dueDatetime ?? null,
        noteBody,
        syncStatus: 'pending_push',
        sourceOfLastChange: 'obsidian',
        dbUpdatedAtUtc: now,
      })
      .where(eq(obsidianTask.todoistTaskId, todoistTaskId));

    await this.db.delete(obsidianTaskLabel).where(eq(obsidianTaskLabel.todoistTaskId, todoistTaskId));

    if (candidate.labels.length > 0) {
      await this.db.insert(obsidianTaskLabel).values(
        candidate.labels.map((label) => ({
          todoistTaskId,
          labelName: label,
        })),
      );
    }
  }

  async updateNoteBody(todoistTaskId: string, noteBody: string) {
    await this.db
      .update(obsidianTask)
      .set({
        noteBody,
        dbUpdatedAtUtc: new Date().toISOString(),
      })
      .where(eq(obsidianTask.todoistTaskId, todoistTaskId));
  }

  async markPushError(todoistTaskId: string) {
    await this.markError(todoistTaskId, 'obsidian');
  }

  async markConflict(todoistTaskId: string) {
    await this.db
      .update(obsidianTask)
      .set({
        syncStatus: 'conflict',
        dbUpdatedAtUtc: new Date().toISOString(),
      })
      .where(eq(obsidianTask.todoistTaskId, todoistTaskId));
  }

  async markError(todoistTaskId: string, sourceOfLastChange: 'obsidian' | 'todoist' | 'system' = 'system') {
    await this.db
      .update(obsidianTask)
      .set({
        syncStatus: 'error',
        sourceOfLastChange,
        dbUpdatedAtUtc: new Date().toISOString(),
      })
      .where(eq(obsidianTask.todoistTaskId, todoistTaskId));
  }

  async markPendingDelete(todoistTaskId: string) {
    await this.db
      .update(obsidianTask)
      .set({
        syncStatus: 'pending_delete',
        sourceOfLastChange: 'obsidian',
        dbUpdatedAtUtc: new Date().toISOString(),
      })
      .where(eq(obsidianTask.todoistTaskId, todoistTaskId));
  }

  async markDeletedAfterRemoteDelete(todoistTaskId: string) {
    const now = new Date().toISOString();

    await this.db
      .update(obsidianTask)
      .set({
        taskStatus: 'deleted',
        syncStatus: 'synced',
        sourceOfLastChange: 'obsidian',
        lastSyncedAtUtc: now,
        dbUpdatedAtUtc: now,
      })
      .where(eq(obsidianTask.todoistTaskId, todoistTaskId));
  }

  async markSyncedAfterPush(task: ObsidianExportTask, labels: string[], todoistUrl?: string) {
    const now = new Date().toISOString();

    await this.db
      .update(obsidianTask)
      .set({
        content: task.content,
        completed: task.completed,
        priorityApi: task.priorityApi,
        project: task.project ?? null,
        dueDate: task.dueDate ?? null,
        dueDatetimeUtc: task.dueDatetimeUtc ?? null,
        todoistUrl: todoistUrl ?? task.todoistUrl,
        sourceUpdatedAtUtc: now,
        dbUpdatedAtUtc: now,
        lastSyncedAtUtc: now,
        syncStatus: 'synced',
        sourceOfLastChange: 'obsidian',
        taskStatus: 'active',
      })
      .where(eq(obsidianTask.todoistTaskId, task.todoistTaskId));

    await this.db.delete(obsidianTaskLabel).where(eq(obsidianTaskLabel.todoistTaskId, task.todoistTaskId));

    if (labels.length > 0) {
      await this.db.insert(obsidianTaskLabel).values(
        labels.map((label) => ({
          todoistTaskId: task.todoistTaskId,
          labelName: label,
        })),
      );
    }
  }
}

function splitProjectLabel(labels?: string[]) {
  const projectLabel = labels?.find((label) => label.startsWith('proj:'));
  const otherLabels = (labels ?? []).filter((label) => label !== projectLabel);

  return {
    project: projectLabel ? humanizeProjectSlug(projectLabel.slice('proj:'.length)) : undefined,
    labels: otherLabels,
  };
}

function humanizeProjectSlug(slug: string) {
  return slug
    .split('-')
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
