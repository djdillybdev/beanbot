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
        await this.taskRepository.markDeletedAfterRemoteDelete(task.todoistTaskId);
        await this.noteIndexRepository.deleteByTaskId(task.todoistTaskId);
        await this.syncEventRepository.insert({
          eventType: 'delete.completed',
          source: 'obsidian',
          todoistTaskId: task.todoistTaskId,
          payloadSummary: JSON.stringify({
            title: task.content,
          }),
          result: 'success',
        });
        this.logger.warn('Deleted Todoist task from local note removal', {
          todoistTaskId: task.todoistTaskId,
          title: task.content,
        });
        deletedTaskCount += 1;
      } catch (error) {
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
}
