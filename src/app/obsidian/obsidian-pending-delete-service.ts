import { ObsidianNoteIndexRepository } from '../../db/obsidian-note-index-repository';
import type { ObsidianTaskRepository } from '../../db/obsidian-task-repository';
import { ObsidianSyncEventRepository } from '../../db/obsidian-sync-event-repository';
import { TodoistClient } from '../../integrations/todoist/client';
import type { Logger } from '../../logging/logger';

export class ObsidianPendingDeleteService {
  constructor(
    private readonly todoistClient: TodoistClient,
    private readonly taskRepository: ObsidianTaskRepository,
    private readonly noteIndexRepository: ObsidianNoteIndexRepository,
    private readonly syncEventRepository: ObsidianSyncEventRepository,
    private readonly logger: Logger,
  ) {}

  async deletePendingTasks() {
    const pendingDeletes = await this.taskRepository.listPendingDelete();
    let deletedTaskCount = 0;
    let deleteErrorCount = 0;

    for (const task of pendingDeletes) {
      try {
        await this.todoistClient.deleteTask(task.todoistTaskId);
        await this.finalizeDelete(task.todoistTaskId, task.content, 'delete.completed', 'success');
        this.logger.warn('Deleted Todoist task from local note removal', {
          todoistTaskId: task.todoistTaskId,
          title: task.content,
        });
        deletedTaskCount += 1;
      } catch (error) {
        if (isTodoistNotFoundError(error)) {
          await this.finalizeDelete(
            task.todoistTaskId,
            task.content,
            'local_delete_already_reconciled',
            'reconciled',
          );
          this.logger.info('Reconciled pending local delete because remote task was already absent', {
            todoistTaskId: task.todoistTaskId,
            title: task.content,
          });
          deletedTaskCount += 1;
          continue;
        }

        await this.taskRepository.markError(task.todoistTaskId, 'obsidian');
        await this.syncEventRepository.insert({
          eventType: 'delete.failed',
          source: 'obsidian',
          todoistTaskId: task.todoistTaskId,
          payloadSummary: error instanceof Error ? error.message : String(error),
          result: 'error',
        });
        this.logger.error('Failed to delete Todoist task from local note removal', error, {
          todoistTaskId: task.todoistTaskId,
          title: task.content,
        });
        deleteErrorCount += 1;
      }
    }

    return { deletedTaskCount, deleteErrorCount };
  }

  async retryTask(todoistTaskId: string) {
    const task = await this.taskRepository.getByTaskId(todoistTaskId);

    if (!task) {
      throw new Error(`No tracked Obsidian task found for ${todoistTaskId}.`);
    }

    try {
      await this.todoistClient.deleteTask(task.todoistTaskId);
      await this.finalizeDelete(task.todoistTaskId, task.content, 'delete.completed', 'success');
      return {
        taskId: todoistTaskId,
        result: 'success' as const,
      };
    } catch (error) {
      if (isTodoistNotFoundError(error)) {
        await this.finalizeDelete(
          task.todoistTaskId,
          task.content,
          'local_delete_already_reconciled',
          'reconciled',
        );
        return {
          taskId: todoistTaskId,
          result: 'reconciled' as const,
        };
      }

      throw error;
    }
  }

  private async finalizeDelete(
    todoistTaskId: string,
    title: string,
    eventType: string,
    result: string,
  ) {
    await this.taskRepository.markReconciledDeleted(todoistTaskId, 'obsidian');
    await this.noteIndexRepository.deleteByTaskId(todoistTaskId);
    await this.syncEventRepository.insert({
      eventType,
      source: 'obsidian',
      todoistTaskId,
      payloadSummary: JSON.stringify({
        title,
      }),
      result,
    });
  }
}

function isTodoistNotFoundError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('404');
}
