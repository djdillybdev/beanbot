import type { ObsidianExportTask, ObsidianTaskRepository } from '../../db/obsidian-task-repository';
import { mergeReservedLabels } from './project-labels';
import { ObsidianSyncEventRepository } from '../../db/obsidian-sync-event-repository';
import { TodoistClient } from '../../integrations/todoist/client';
import type { Logger } from '../../logging/logger';

export class ObsidianPendingPushService {
  constructor(
    private readonly todoistClient: TodoistClient,
    private readonly taskRepository: ObsidianTaskRepository,
    private readonly syncEventRepository: ObsidianSyncEventRepository,
    private readonly logger: Logger,
  ) {}

  async pushPendingTasks() {
    const pendingTasks = await this.taskRepository.listPendingPush();
    let pushedTaskCount = 0;

    for (const task of pendingTasks) {
      try {
        await this.pushTask(task);
        pushedTaskCount += 1;
      } catch (error) {
        await this.taskRepository.markPushError(task.todoistTaskId);
        await this.syncEventRepository.insert({
          eventType: 'push.failed',
          source: 'obsidian',
          todoistTaskId: task.todoistTaskId,
          payloadSummary: error instanceof Error ? error.message : String(error),
          result: 'error',
        });
        this.logger.warn('Obsidian task entered sync error state after push failure', {
          todoistTaskId: task.todoistTaskId,
        });
        this.logger.error('Failed to push Obsidian task changes to Todoist', error, {
          todoistTaskId: task.todoistTaskId,
        });
      }
    }

    return { pushedTaskCount };
  }

  async retryTask(todoistTaskId: string) {
    const task = await this.taskRepository.getByTaskId(todoistTaskId);

    if (!task) {
      throw new Error(`No tracked Obsidian task found for ${todoistTaskId}.`);
    }

    await this.pushTask(task);

    return {
      taskId: todoistTaskId,
      syncStatus: 'synced',
      result: 'success' as const,
    };
  }

  private async pushTask(task: ObsidianExportTask) {
    const labels = mergeReservedLabels(task.project, task.effort, task.labels);
    await this.todoistClient.getTask(task.todoistTaskId);

    const updatedTask = await this.todoistClient.updateTask(task.todoistTaskId, {
      content: task.content,
      labels,
      priority: normalizePriority(task.priorityApi),
      due_date: task.dueDatetimeUtc ? null : (task.dueDate ?? null),
      due_datetime: task.dueDatetimeUtc ?? null,
      due_string: !task.dueDate && !task.dueDatetimeUtc ? null : undefined,
    });

    if (task.completed) {
      await this.todoistClient.closeTask(task.todoistTaskId);
    }

    await this.taskRepository.markSyncedAfterPush(task, task.labels, updatedTask.url);

    await this.syncEventRepository.insert({
      eventType: 'push.completed',
      source: 'obsidian',
      todoistTaskId: task.todoistTaskId,
      payloadSummary: JSON.stringify({
        completed: task.completed,
        labelCount: labels.length,
      }),
      result: 'success',
    });
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
