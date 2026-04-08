import type { DailyTaskSummary } from '../../domain/daily-review';
import { HabitService } from '../habits/habit-service';
import type { ReminderService } from '../reminders/reminder-service';
import { ActionLogRepository } from '../../db/action-log-repository';
import { TodoistTaskMapRepository } from '../../db/todoist-task-map-repository';
import type {
  InboxTaskCaptureResult,
  ProjectAutocompleteSuggestion,
  TaskAutocompleteSuggestion,
  TaskCommandResult,
  TaskCompletionResolution,
  TaskCreateInput,
  TaskEditInput,
  TodoistProjectRecord,
  TodoistTaskRecord,
} from '../../domain/task';
import { TodoistClient } from '../../integrations/todoist/client';
import type { Logger } from '../../logging/logger';
import { TodayStatusRefreshNotifier } from '../today/today-status-refresh-notifier';
import { normalizeTaskTitle } from '../../utils/text';
import { buildTaskAutocompleteLabel } from '../../bot/renderers/task-autocomplete';

export class TaskService {
  constructor(
    private readonly timezone: string,
    private readonly todoistClient: TodoistClient,
    private readonly taskMapRepository: TodoistTaskMapRepository,
    private readonly actionLogRepository: ActionLogRepository,
    private readonly habitService?: HabitService,
    private readonly reminderService?: ReminderService,
    private readonly todayStatusRefreshNotifier?: TodayStatusRefreshNotifier,
    private readonly logger?: Logger,
  ) {}

  async addTask(input: TaskCreateInput): Promise<TaskCommandResult> {
    this.logger?.debug('Creating Todoist task', {
      hasDue: Boolean(input.due),
      hasProjectId: Boolean(input.projectId),
      labelCount: input.labels?.length ?? 0,
      priority: input.priority ?? 1,
    });
    const task = await this.todoistClient.createTask(input);
    await this.taskMapRepository.upsert(task);
    await this.actionLogRepository.insert({
      actionType: 'task.add',
      sourceCommand: '/task add',
      payloadJson: JSON.stringify(input),
      resultJson: JSON.stringify(task),
    });
    await this.reminderService?.syncTask(task);
    this.logger?.info('Created Todoist task', {
      taskId: task.id,
      projectId: task.projectId,
      hasDue: Boolean(task.dueDate || task.dueDateTimeUtc),
    });
    this.todayStatusRefreshNotifier?.requestRefresh('task.add');

    return { task };
  }

  async addInboxTask(rawText: string): Promise<InboxTaskCaptureResult> {
    const text = rawText.trim();

    if (text.length === 0) {
      this.logger?.warn('Rejected inbox capture because message text was empty.');
      throw new Error('Inbox capture needs message text. Send a plain text message in #inbox.');
    }

    try {
      this.logger?.debug('Creating inbox task via quick add', {
        text: rawText,
        textLength: text.length,
      });
      const result = await this.todoistClient.quickAddTask(text);
      await this.actionLogRepository.insert({
        actionType: 'task.inbox_add',
        sourceCommand: 'inbox.message',
        payloadJson: JSON.stringify({ text }),
        resultJson: JSON.stringify(result),
      });

      this.logger?.info('Created inbox task via quick add', { textLength: text.length });
      this.todayStatusRefreshNotifier?.requestRefresh('task.inbox_add');
      return result;
    } catch (error) {
      await this.actionLogRepository.insert({
        actionType: 'task.inbox_add.failed',
        sourceCommand: 'inbox.message',
        payloadJson: JSON.stringify({ text }),
        resultJson: JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        }),
      });
      this.logger?.error('Inbox quick add failed', error, { textLength: text.length });
      throw error;
    }
  }

  async completeTask(query: string): Promise<
    | { status: 'completed'; task: TodoistTaskRecord }
    | { status: 'no_match'; resolution: TaskCompletionResolution }
    | { status: 'ambiguous'; resolution: TaskCompletionResolution }
  > {
    const taskById = await this.findActiveTaskForMutation(query);

    if (taskById) {
      await this.todoistClient.closeTask(taskById.id);
      await this.taskMapRepository.updateStatus(taskById.id, 'completed');
      await this.recordHabitCompletion(taskById);
      await this.actionLogRepository.insert({
        actionType: 'task.done',
        sourceCommand: '/task done',
        payloadJson: JSON.stringify({ query, taskId: taskById.id, resolver: 'autocomplete-id' }),
        resultJson: JSON.stringify(taskById),
      });
      await this.reminderService?.cancelTaskReminders(taskById.id);
      this.logger?.info('Completed Todoist task', { taskId: taskById.id, resolver: 'autocomplete-id' });
      this.todayStatusRefreshNotifier?.requestRefresh('task.done');

      return {
        status: 'completed',
        task: { ...taskById, taskStatus: 'completed' },
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
      this.logger?.warn('No recent task matched completion query', { query });
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
      this.logger?.warn('Task completion query was ambiguous', {
        query,
        matchCount: matches.length,
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
    await this.taskMapRepository.updateStatus(task.id, 'completed');
    await this.recordHabitCompletion(task);
    await this.actionLogRepository.insert({
      actionType: 'task.done',
      sourceCommand: '/task done',
      payloadJson: JSON.stringify({ query, taskId: task.id, resolver: 'title-fallback' }),
      resultJson: JSON.stringify(task),
    });
    await this.reminderService?.cancelTaskReminders(task.id);
    this.logger?.info('Completed Todoist task', { taskId: task.id, resolver: 'title-fallback' });
    this.todayStatusRefreshNotifier?.requestRefresh('task.done');

    return {
      status: 'completed',
      task: { ...task, taskStatus: 'completed' },
    };
  }

  async getTaskForEdit(taskId: string): Promise<TodoistTaskRecord | null> {
    const cachedTask = await this.findActiveTaskForMutation(taskId);

    if (!cachedTask) {
      return null;
    }

    try {
      const freshTask = await this.todoistClient.getTask(taskId);
      await this.taskMapRepository.upsert(freshTask);
      return freshTask;
    } catch {
      return cachedTask;
    }
  }

  async editTask(taskId: string, input: TaskEditInput): Promise<TodoistTaskRecord> {
    this.logger?.debug('Editing Todoist task', {
      taskId,
      hasContent: Boolean(input.content?.trim()),
      hasDueString: Boolean(input.dueString?.trim()),
      hasProjectName: Boolean(input.projectName?.trim()),
      labelCount: input.labels?.length ?? 0,
      priority: input.priority,
    });
    const existingTask = await this.findActiveTaskForMutation(taskId);

    if (!existingTask) {
      throw new Error('That task is no longer available in the recent active cache.');
    }

    const content = input.content?.trim() ?? '';
    if (content.length === 0) {
      throw new Error('Task title cannot be blank. Provide a title in the modal before saving.');
    }

    const dueString = input.dueString?.trim() ?? '';
    const projectName = input.projectName?.trim() ?? '';
    const nextLabels = input.labels ?? [];
    const currentLabels = existingTask.labels ?? [];

    const patch: {
      content?: string;
      due_string?: string | null;
      labels?: string[];
      priority?: 1 | 2 | 3 | 4;
    } = {};

    if (content !== existingTask.title) {
      patch.content = content;
    }

    if (dueString !== (existingTask.dueString ?? '')) {
      patch.due_string = dueString.length > 0 ? dueString : null;
    }

    if (!sameLabels(currentLabels, nextLabels)) {
      patch.labels = nextLabels;
    }

    if (input.priority && input.priority !== existingTask.priority) {
      patch.priority = input.priority;
    } else if (!input.priority && existingTask.priority !== 1) {
      patch.priority = 1;
    }

    let projectIdToMove: string | undefined;

    if (projectName !== (existingTask.projectName ?? '')) {
      if (projectName.length === 0) {
        const inboxProject = await this.getInboxProject();
        projectIdToMove = inboxProject.id;
      } else {
        const matchingProjects = await this.findProjectsByExactName(projectName);

        if (matchingProjects.length === 0) {
          throw new Error(`No Todoist project matched "${projectName}". Use the exact project name.`);
        }

        if (matchingProjects.length > 1) {
          throw new Error(`Multiple Todoist projects matched "${projectName}". Use a unique project name.`);
        }

        const project = matchingProjects[0];

        if (project && project.id !== existingTask.projectId) {
          projectIdToMove = project.id;
        }
      }
    }

    const hasPatchChanges = Object.keys(patch).length > 0;
    const hasMove = Boolean(projectIdToMove);

    if (!hasPatchChanges && !hasMove) {
      return existingTask;
    }

    if (hasPatchChanges) {
      await this.todoistClient.updateTask(taskId, patch);
    }

    if (projectIdToMove) {
      await this.todoistClient.moveTaskToProject(taskId, projectIdToMove);
    }

    const task = await this.todoistClient.getTask(taskId);
    await this.taskMapRepository.upsert(task);
    await this.actionLogRepository.insert({
      actionType: 'task.edit',
      sourceCommand: '/task edit',
      payloadJson: JSON.stringify({ taskId, input }),
      resultJson: JSON.stringify(task),
    });
    await this.reminderService?.syncTask(task);
    this.logger?.info('Updated Todoist task', { taskId: task.id, projectId: task.projectId });
    this.todayStatusRefreshNotifier?.requestRefresh('task.edit');

    return task;
  }

  async deleteTask(taskId: string): Promise<TodoistTaskRecord> {
    const task = await this.findActiveTaskForMutation(taskId);

    if (!task) {
      throw new Error('That task is no longer available in the recent active cache.');
    }

    await this.todoistClient.deleteTask(taskId);
    await this.taskMapRepository.updateStatus(taskId, 'deleted');
    await this.actionLogRepository.insert({
      actionType: 'task.delete',
      sourceCommand: '/task delete',
      payloadJson: JSON.stringify({ taskId }),
      resultJson: JSON.stringify(task),
    });
    await this.reminderService?.cancelTaskReminders(taskId);
    this.logger?.info('Deleted Todoist task', { taskId });
    this.todayStatusRefreshNotifier?.requestRefresh('task.delete');

    return { ...task, taskStatus: 'deleted' };
  }

  async reopenTask(taskId: string): Promise<TodoistTaskRecord> {
    const task = await this.taskMapRepository.findById(taskId, ['completed']);

    if (!task) {
      if (isLikelyTodoistId(taskId)) {
        await this.todoistClient.reopenTask(taskId);
        const reopenedTask = await this.todoistClient.getTask(taskId);
        await this.taskMapRepository.upsert(reopenedTask);
        await this.deleteLatestHabitCompletion(taskId);
        await this.reminderService?.syncTask(reopenedTask);
        this.todayStatusRefreshNotifier?.requestRefresh('task.reopen');
        return reopenedTask;
      }

      throw new Error('That task is not available in the recent completed cache. Try reopening it from a recent autocomplete result.');
    }

    await this.todoistClient.reopenTask(taskId);
    await this.deleteLatestHabitCompletion(taskId);
    const reopenedTask = await this.todoistClient.getTask(taskId);
    await this.taskMapRepository.upsert(reopenedTask);
    await this.actionLogRepository.insert({
      actionType: 'task.reopen',
      sourceCommand: '/task reopen',
      payloadJson: JSON.stringify({ taskId }),
      resultJson: JSON.stringify(reopenedTask),
    });
    await this.reminderService?.syncTask(reopenedTask);
    this.logger?.info('Reopened Todoist task', { taskId });
    this.todayStatusRefreshNotifier?.requestRefresh('task.reopen');

    return reopenedTask;
  }

  async rememberTasks(tasks: TodoistTaskRecord[]) {
    this.logger?.debug('Refreshing task cache with full records', { taskCount: tasks.length });
    for (const task of tasks) {
      await this.taskMapRepository.upsert(task);
    }
  }

  async rememberTaskSummaries(tasks: DailyTaskSummary[]) {
    this.logger?.debug('Refreshing task cache with summaries', { taskCount: tasks.length });
    for (const task of tasks) {
      await this.taskMapRepository.upsert({
        id: task.id,
        title: task.title,
        normalizedTitle: normalizeTaskTitle(task.title),
        priority: task.priority,
        projectId: task.projectId,
        projectName: task.projectName,
        dueLabel: task.dueLabel,
        dueDate: task.dateKey,
        dueDateTimeUtc: undefined,
        dueString: task.dueString,
        recurring: task.recurring,
        labels: task.labels,
        url: task.url,
        taskStatus: 'active',
      });
    }
  }

  async getTaskDoneAutocompleteSuggestions(query: string): Promise<TaskAutocompleteSuggestion[]> {
    this.logger?.debug('Building task autocomplete suggestions', {
      mode: 'done',
      queryLength: query.length,
    });
    return this.getTaskAutocompleteSuggestions(query, ['active']);
  }

  async getTaskReopenAutocompleteSuggestions(query: string): Promise<TaskAutocompleteSuggestion[]> {
    this.logger?.debug('Building task autocomplete suggestions', {
      mode: 'reopen',
      queryLength: query.length,
    });
    return this.getTaskAutocompleteSuggestions(query, ['completed']);
  }

  async getProjectAutocompleteSuggestions(query: string): Promise<ProjectAutocompleteSuggestion[]> {
    const projects = await this.todoistClient.getProjects();
    const normalizedQuery = normalizeTaskTitle(query);

    const suggestions = rankProjects(projects, normalizedQuery).slice(0, 25).map((project) => ({
      name: project.name,
      value: project.id,
    }));

    this.logger?.debug('Built project autocomplete suggestions', {
      queryLength: query.length,
      suggestionCount: suggestions.length,
    });

    return suggestions;
  }

  async validateProjectSelection(projectValue: string): Promise<TodoistProjectRecord | null> {
    const projects = await this.todoistClient.getProjects();
    return projects.find((project) => project.id === projectValue) ?? null;
  }

  private async getTaskAutocompleteSuggestions(
    query: string,
    statuses: Array<'active' | 'completed'>,
  ): Promise<TaskAutocompleteSuggestion[]> {
    const normalizedQuery = normalizeTaskTitle(query);
    const tasks = await this.taskMapRepository.getAutocompleteCandidates(normalizedQuery, statuses);

    return rankAutocompleteTasks(tasks, normalizedQuery).slice(0, 25).map((task) => ({
      name: buildTaskAutocompleteLabel(task),
      value: task.id,
    }));
  }

  private async findProjectsByExactName(projectName: string): Promise<TodoistProjectRecord[]> {
    const normalizedName = normalizeTaskTitle(projectName);
    const projects = await this.todoistClient.getProjects();

    return projects.filter((project) => normalizeTaskTitle(project.name) === normalizedName);
  }

  private async getInboxProject(): Promise<TodoistProjectRecord> {
    const projects = await this.todoistClient.getProjects();
    const inboxProject = projects.find((project) => project.isInboxProject);

    if (!inboxProject) {
      throw new Error('Todoist Inbox project was not found, so the project field cannot be cleared safely.');
    }

    return inboxProject;
  }

  private async recordHabitCompletion(task: TodoistTaskRecord) {
    await this.habitService?.recordCompletion(task, new Date().toISOString(), 'bot');
  }

  private async deleteLatestHabitCompletion(taskId: string) {
    await this.habitService?.deleteLatestCompletionForTask(taskId);
  }

  private async findActiveTaskForMutation(taskId: string) {
    const cachedTask = await this.taskMapRepository.findById(taskId, ['active']);

    if (cachedTask) {
      return cachedTask;
    }

    if (!isLikelyTodoistId(taskId)) {
      return null;
    }

    try {
      const freshTask = await this.todoistClient.getTask(taskId);
      await this.taskMapRepository.upsert(freshTask);
      return freshTask.taskStatus === 'active' ? freshTask : null;
    } catch {
      return null;
    }
  }
}

function rankAutocompleteTasks(tasks: TodoistTaskRecord[], normalizedQuery: string) {
  const query = normalizedQuery.trim();

  return [...tasks].sort((left, right) => {
    const leftRank = getAutocompleteRank(left.normalizedTitle, query);
    const rightRank = getAutocompleteRank(right.normalizedTitle, query);

    return (
      leftRank - rightRank ||
      compareProjectName(left.projectName, right.projectName) ||
      left.title.localeCompare(right.title)
    );
  });
}

function getAutocompleteRank(title: string, query: string) {
  if (query.length === 0) {
    return 3;
  }

  if (title === query) {
    return 0;
  }

  if (title.startsWith(query)) {
    return 1;
  }

  if (title.includes(query)) {
    return 2;
  }

  return 3;
}

function compareProjectName(left?: string, right?: string) {
  if (left && right) {
    return left.localeCompare(right);
  }

  if (left) {
    return -1;
  }

  if (right) {
    return 1;
  }

  return 0;
}

function rankProjects(projects: TodoistProjectRecord[], normalizedQuery: string) {
  const query = normalizedQuery.trim();

  return [...projects].sort((left, right) => {
    const leftTitle = normalizeTaskTitle(left.name);
    const rightTitle = normalizeTaskTitle(right.name);
    const leftRank = getAutocompleteRank(leftTitle, query);
    const rightRank = getAutocompleteRank(rightTitle, query);

    return leftRank - rightRank || left.name.localeCompare(right.name);
  });
}

function sameLabels(left: string[], right: string[]) {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((label, index) => label === right[index]);
}

function isLikelyTodoistId(value: string) {
  return /^[0-9]{6,}$/.test(value.trim());
}
