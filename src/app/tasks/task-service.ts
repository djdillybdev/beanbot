import type { DailyTaskSummary } from '../../domain/daily-review';
import { ActionLogRepository } from '../../db/action-log-repository';
import { TodoistTaskMapRepository } from '../../db/todoist-task-map-repository';
import type {
  TaskAutocompleteSuggestion,
  TaskCommandResult,
  TaskCompletionResolution,
  TodoistTaskRecord,
} from '../../domain/task';
import { TodoistClient } from '../../integrations/todoist/client';
import { normalizeTaskTitle } from '../../utils/text';
import { buildTaskAutocompleteLabel } from '../../bot/renderers/task-autocomplete';

export class TaskService {
  constructor(
    private readonly todoistClient: TodoistClient,
    private readonly taskMapRepository: TodoistTaskMapRepository,
    private readonly actionLogRepository: ActionLogRepository,
  ) {}

  async addTask(content: string): Promise<TaskCommandResult> {
    const task = await this.todoistClient.quickAddTask(content);
    await this.taskMapRepository.upsert(task);
    await this.actionLogRepository.insert({
      actionType: 'task.add',
      sourceCommand: '/task add',
      payloadJson: JSON.stringify({ content }),
      resultJson: JSON.stringify(task),
    });

    return { task };
  }

  async completeTask(query: string): Promise<
    | { status: 'completed'; task: TodoistTaskRecord }
    | { status: 'no_match'; resolution: TaskCompletionResolution }
    | { status: 'ambiguous'; resolution: TaskCompletionResolution }
  > {
    const taskById = await this.taskMapRepository.findActiveById(query);

    if (taskById) {
      await this.todoistClient.closeTask(taskById.id);
      await this.taskMapRepository.markCompleted(taskById.id);
      await this.actionLogRepository.insert({
        actionType: 'task.done',
        sourceCommand: '/task done',
        payloadJson: JSON.stringify({ query, taskId: taskById.id, resolver: 'autocomplete-id' }),
        resultJson: JSON.stringify(taskById),
      });

      return {
        status: 'completed',
        task: taskById,
      };
    }

    const normalizedTitle = normalizeTaskTitle(query);
    const matches = await this.taskMapRepository.findActiveByNormalizedTitle(normalizedTitle);

    if (matches.length === 0) {
      await this.actionLogRepository.insert({
        actionType: 'task.done.no_match',
        sourceCommand: '/task done',
        payloadJson: JSON.stringify({ query }),
      });
      return {
        status: 'no_match',
        resolution: { matches: [], query },
      };
    }

    if (matches.length > 1) {
      await this.actionLogRepository.insert({
        actionType: 'task.done.ambiguous',
        sourceCommand: '/task done',
        payloadJson: JSON.stringify({ query }),
        resultJson: JSON.stringify(matches),
      });
      return {
        status: 'ambiguous',
        resolution: { matches, query },
      };
    }

    const task = matches[0];

    if (!task) {
      throw new Error('Expected a single task match but found none.');
    }

    await this.todoistClient.closeTask(task.id);
    await this.taskMapRepository.markCompleted(task.id);
    await this.actionLogRepository.insert({
      actionType: 'task.done',
      sourceCommand: '/task done',
      payloadJson: JSON.stringify({ query, taskId: task.id }),
      resultJson: JSON.stringify(task),
    });

    return {
      status: 'completed',
      task,
    };
  }

  async rememberTasks(tasks: TodoistTaskRecord[]) {
    for (const task of tasks) {
      await this.taskMapRepository.upsert(task);
    }
  }

  async rememberTaskSummaries(tasks: DailyTaskSummary[]) {
    for (const task of tasks) {
      await this.taskMapRepository.upsert({
        id: task.id,
        title: task.title,
        normalizedTitle: normalizeTaskTitle(task.title),
        priority: task.priority,
        dueLabel: task.dueLabel,
        dueDate: task.dateKey,
        url: task.url,
        isActive: true,
      });
    }
  }

  async getTaskDoneAutocompleteSuggestions(query: string): Promise<TaskAutocompleteSuggestion[]> {
    const normalizedQuery = normalizeTaskTitle(query);
    const tasks = await this.taskMapRepository.getAutocompleteSuggestions(normalizedQuery);

    return tasks.map((task) => ({
      name: buildTaskAutocompleteLabel(task),
      value: task.id,
    }));
  }
}
