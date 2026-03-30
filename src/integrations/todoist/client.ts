import type { AppConfig } from '../../config';
import type { CompletedTaskSummary, DailyTaskSummary, UndatedTaskSummary } from '../../domain/daily-review';
import type {
  InboxTaskCaptureResult,
  TodoistCompletedTaskRecord,
  TaskCreateInput,
  TodoistProjectRecord,
  TodoistTaskRecord,
} from '../../domain/task';
import type { StoredOAuthToken } from '../../domain/oauth';
import { getLocalDateParts, formatLocalTime, getZonedDayBounds } from '../../utils/time';
import { OAuthTokenRepository } from '../../db/oauth-token-repository';
import { normalizeTaskTitle } from '../../utils/text';

const TODOIST_API_BASE_URL = 'https://api.todoist.com/api/v1';

interface TodoistTaskResponse {
  id: string;
  content: string;
  priority: number;
  project_id?: string | null;
  section_id?: string | null;
  parent_id?: string | null;
  child_order?: number | null;
  order?: number | null;
  created_at?: string | null;
  labels?: string[] | null;
  url?: string;
  due?: {
    date?: string;
    datetime?: string;
    string?: string;
    is_recurring?: boolean;
  } | null;
}

interface TodoistProjectResponse {
  id: string;
  name: string;
  is_inbox_project?: boolean;
}

interface TodoistTaskUpdatePayload {
  content?: string;
  labels?: string[];
  priority?: 1 | 2 | 3 | 4;
  due_string?: string | null;
  due_date?: string | null;
  due_datetime?: string | null;
}

interface TodoistCompletedTaskResponse {
  id: string;
  content: string;
  priority: number;
  project_id?: string | null;
  completed_at: string;
}

export class TodoistClient {
  constructor(
    private readonly config: AppConfig,
    private readonly tokenRepository: OAuthTokenRepository,
  ) {}

  isConfigured(): boolean {
    return Boolean(
      this.config.env.OAUTH_STATE_SECRET &&
        this.config.env.TODOIST_CLIENT_ID &&
        this.config.env.TODOIST_CLIENT_SECRET &&
        this.config.env.TODOIST_REDIRECT_URI,
    );
  }

  async isConnected(): Promise<boolean> {
    return (await this.tokenRepository.getByProvider('todoist')) !== null;
  }

  async getDailyTasks(): Promise<{ overdueTasks: DailyTaskSummary[]; dueTodayTasks: DailyTaskSummary[] }> {
    return this.getTasksForUpcomingDays(1);
  }

  async getCompletedTasksForToday(now = new Date()): Promise<CompletedTaskSummary[]> {
    const dayBounds = getZonedDayBounds(now, this.config.timezone);
    return this.getCompletedTasksInRange(dayBounds.startUtc, dayBounds.endUtc);
  }

  async getCompletedTasksInRange(since: string, until: string): Promise<CompletedTaskSummary[]> {
    const token = await this.requireToken();
    const tasks = await this.fetchCompletedTasksByCompletionDate(token, since, until);
    const projects = await this.fetchProjects(token);
    const projectNames = new Map(projects.map((project) => [project.id, project.name]));

    return tasks
      .map((task) => mapCompletedTaskSummary(task, this.config.timezone, task.projectId ? projectNames.get(task.projectId) : undefined))
      .sort((left, right) => left.completedSortKey.localeCompare(right.completedSortKey));
  }

  async getTasksForUpcomingDays(
    days: number,
  ): Promise<{ overdueTasks: DailyTaskSummary[]; dueTodayTasks: DailyTaskSummary[] }> {
    const token = await this.requireToken();
    const tasks = await this.fetchFilteredTasks(token, buildTodoistDateFilter(days));
    const projects = await this.fetchProjects(token);
    const projectNames = new Map(projects.map((project) => [project.id, project.name]));
    const today = getLocalDateParts(new Date(), this.config.timezone).date;
    const endExclusive = addDays(today, days);

    const overdueTasks: DailyTaskSummary[] = [];
    const dueTodayTasks: DailyTaskSummary[] = [];

    for (const task of tasks) {
      const classification = classifyTodoistTask(task, today, endExclusive, this.config.timezone);

      if (!classification) {
        continue;
      }

      const summary: DailyTaskSummary = {
        id: task.id,
        title: task.content,
        priority: task.priority,
        dateKey: classification.dateKey,
        projectId: task.project_id ?? undefined,
        projectName: task.project_id ? projectNames.get(task.project_id) : undefined,
        dueLabel: classification.label,
        dueSortKey: classification.sortKey,
        labels: task.labels ?? undefined,
        url: `https://app.todoist.com/app/task/${task.id}`,
      };

      if (classification.kind === 'overdue') {
        overdueTasks.push(summary);
      } else {
        dueTodayTasks.push(summary);
      }
    }

    overdueTasks.sort(compareTaskSummaries);
    dueTodayTasks.sort(compareTaskSummaries);

    return { overdueTasks, dueTodayTasks };
  }

  async getTaskRecordsForUpcomingDays(days: number): Promise<TodoistTaskRecord[]> {
    const token = await this.requireToken();
    const tasks = await this.fetchFilteredTasks(token, buildTodoistDateFilter(days));
    const projects = await this.fetchProjects(token);
    const projectNames = new Map(projects.map((project) => [project.id, project.name]));
    const today = getLocalDateParts(new Date(), this.config.timezone).date;
    const endExclusive = addDays(today, days);

    return tasks
      .map((task) =>
        mapTaskRecord(
          task,
          today,
          endExclusive,
          this.config.timezone,
          task.project_id ? projectNames.get(task.project_id) : undefined,
        ),
      )
      .filter((task): task is TodoistTaskRecord => task !== null);
  }

  async getUndatedTasks(): Promise<{ tasks: UndatedTaskSummary[] }> {
    const token = await this.requireToken();
    const tasks = await this.fetchFilteredTasks(token, 'no date');
    const projects = await this.fetchProjects(token);
    const projectNames = new Map(projects.map((project) => [project.id, project.name]));

    return {
      tasks: tasks
        .filter((task) => !task.due)
        .map((task) => ({
          id: task.id,
          title: task.content,
          priority: task.priority,
          projectId: task.project_id ?? undefined,
          projectName: task.project_id ? projectNames.get(task.project_id) : undefined,
          labels: task.labels ?? undefined,
          url: task.url ?? `https://app.todoist.com/app/task/${task.id}`,
        })),
    };
  }

  async getAllActiveTaskRecords(): Promise<TodoistTaskRecord[]> {
    const token = await this.requireToken();
    const tasks = await this.fetchActiveTasks(token);
    const projects = await this.fetchProjects(token);
    const projectNames = new Map(projects.map((project) => [project.id, project.name]));

    return tasks
      .map((task) =>
        mapActiveTaskRecord(
          task,
          this.config.timezone,
          task.project_id ? projectNames.get(task.project_id) : undefined,
        ),
      )
      .sort((left, right) => left.title.localeCompare(right.title));
  }

  async createTask(input: TaskCreateInput): Promise<TodoistTaskRecord> {
    const token = await this.requireToken();
    const payload: Record<string, unknown> = {
      content: input.content,
    };

    if (input.priority) {
      payload.priority = input.priority;
    }

    if (input.projectId) {
      payload.project_id = input.projectId;
    }

    if (input.labels) {
      payload.labels = input.labels;
    }

    if (input.dueDatetime) {
      payload.due_datetime = input.dueDatetime;
    } else if (input.dueDate) {
      payload.due_date = input.dueDate;
    } else if (input.due) {
      payload.due_string = input.due;
    }

    const response = await fetch(`${TODOIST_API_BASE_URL}/tasks`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Todoist create task failed: ${response.status} ${text}`);
    }

    const task = (await response.json()) as TodoistTaskResponse;
    const projects = await this.fetchProjects(token);
    const projectNames = new Map(projects.map((project) => [project.id, project.name]));

    return mapActiveTaskRecord(
      task,
      this.config.timezone,
      task.project_id ? projectNames.get(task.project_id) : undefined,
    );
  }

  async quickAddTask(text: string): Promise<InboxTaskCaptureResult> {
    const token = await this.requireToken();
    const response = await fetch(`${TODOIST_API_BASE_URL}/tasks/quick`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Todoist quick add failed: ${response.status} ${body}`);
    }

    return { text };
  }

  async getTask(taskId: string): Promise<TodoistTaskRecord> {
    const token = await this.requireToken();
    const response = await fetch(`${TODOIST_API_BASE_URL}/tasks/${taskId}`, {
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Todoist get task failed: ${response.status} ${text}`);
    }

    const task = (await response.json()) as TodoistTaskResponse;
    const projects = await this.fetchProjects(token);
    const projectNames = new Map(projects.map((project) => [project.id, project.name]));

    return mapActiveTaskRecord(
      task,
      this.config.timezone,
      task.project_id ? projectNames.get(task.project_id) : undefined,
    );
  }

  async updateTask(taskId: string, patch: TodoistTaskUpdatePayload): Promise<TodoistTaskRecord> {
    const token = await this.requireToken();
    const response = await fetch(`${TODOIST_API_BASE_URL}/tasks/${taskId}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(patch),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Todoist update task failed: ${response.status} ${text}`);
    }

    const task = (await response.json()) as TodoistTaskResponse;
    const projects = await this.fetchProjects(token);
    const projectNames = new Map(projects.map((project) => [project.id, project.name]));

    return mapActiveTaskRecord(
      task,
      this.config.timezone,
      task.project_id ? projectNames.get(task.project_id) : undefined,
    );
  }

  async moveTaskToProject(taskId: string, projectId: string): Promise<TodoistTaskRecord> {
    const token = await this.requireToken();
    const response = await fetch(`${TODOIST_API_BASE_URL}/tasks/${taskId}/move`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ project_id: projectId }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Todoist move task failed: ${response.status} ${text}`);
    }

    const task = (await response.json()) as TodoistTaskResponse;
    const projects = await this.fetchProjects(token);
    const projectNames = new Map(projects.map((project) => [project.id, project.name]));

    return mapActiveTaskRecord(
      task,
      this.config.timezone,
      task.project_id ? projectNames.get(task.project_id) : undefined,
    );
  }

  async closeTask(taskId: string) {
    const token = await this.requireToken();
    const response = await fetch(`${TODOIST_API_BASE_URL}/tasks/${taskId}/close`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Todoist close task failed: ${response.status} ${text}`);
    }
  }

  async reopenTask(taskId: string) {
    const token = await this.requireToken();
    const response = await fetch(`${TODOIST_API_BASE_URL}/tasks/${taskId}/reopen`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Todoist reopen task failed: ${response.status} ${text}`);
    }
  }

  async deleteTask(taskId: string) {
    const token = await this.requireToken();
    const response = await fetch(`${TODOIST_API_BASE_URL}/tasks/${taskId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Todoist delete task failed: ${response.status} ${text}`);
    }
  }

  async getProjects(): Promise<TodoistProjectRecord[]> {
    const token = await this.requireToken();
    const projects = await this.fetchProjects(token);

    return projects
      .map((project) => ({
        id: project.id,
        name: project.name,
        isInboxProject: project.is_inbox_project ?? false,
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  private async requireToken(): Promise<StoredOAuthToken> {
    const token = await this.tokenRepository.getByProvider('todoist');

    if (!token) {
      throw new Error('Todoist is not connected.');
    }

    return token;
  }

  private async fetchFilteredTasks(token: StoredOAuthToken, query: string) {
    const results: TodoistTaskResponse[] = [];
    let cursor: string | null = null;

    do {
      const url = new URL(`${TODOIST_API_BASE_URL}/tasks/filter`);
      url.searchParams.set('query', query);
      url.searchParams.set('limit', '200');
      if (cursor) {
        url.searchParams.set('cursor', cursor);
      }

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token.accessToken}`,
        },
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Todoist task fetch failed: ${response.status} ${text}`);
      }

      const payload = (await response.json()) as {
        results: TodoistTaskResponse[];
        next_cursor?: string | null;
      };

      results.push(...payload.results);
      cursor = payload.next_cursor ?? null;
    } while (cursor);

    return results;
  }

  private async fetchActiveTasks(token: StoredOAuthToken) {
    const results: TodoistTaskResponse[] = [];
    let cursor: string | null = null;

    do {
      const url = new URL(`${TODOIST_API_BASE_URL}/tasks`);
      url.searchParams.set('limit', '200');
      if (cursor) {
        url.searchParams.set('cursor', cursor);
      }

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token.accessToken}`,
        },
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Todoist active tasks fetch failed: ${response.status} ${text}`);
      }

      const payload = (await response.json()) as {
        results: TodoistTaskResponse[];
        next_cursor?: string | null;
      };

      results.push(...payload.results);
      cursor = payload.next_cursor ?? null;
    } while (cursor);

    return results;
  }

  private async fetchProjects(token: StoredOAuthToken) {
    const projects: TodoistProjectResponse[] = [];
    let cursor: string | null = null;

    do {
      const url = new URL(`${TODOIST_API_BASE_URL}/projects`);
      url.searchParams.set('limit', '200');
      if (cursor) {
        url.searchParams.set('cursor', cursor);
      }

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token.accessToken}`,
        },
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Todoist projects fetch failed: ${response.status} ${text}`);
      }

      const payload = (await response.json()) as {
        results: TodoistProjectResponse[];
        next_cursor?: string | null;
      };

      projects.push(...payload.results);
      cursor = payload.next_cursor ?? null;
    } while (cursor);

    return projects;
  }

  private async fetchCompletedTasksByCompletionDate(
    token: StoredOAuthToken,
    since: string,
    until: string,
  ): Promise<TodoistCompletedTaskRecord[]> {
    const results: TodoistCompletedTaskRecord[] = [];
    let cursor: string | null = null;

    do {
      const url = new URL(`${TODOIST_API_BASE_URL}/tasks/completed/by_completion_date`);
      url.searchParams.set('since', since);
      url.searchParams.set('until', until);
      url.searchParams.set('limit', '200');

      if (cursor) {
        url.searchParams.set('cursor', cursor);
      }

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token.accessToken}`,
        },
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Todoist completed tasks fetch failed: ${response.status} ${text}`);
      }

      const payload = (await response.json()) as {
        items: TodoistCompletedTaskResponse[];
        next_cursor?: string | null;
      };

      results.push(
        ...payload.items.map((task) => ({
          id: task.id,
          title: task.content,
          priority: task.priority,
          projectId: task.project_id ?? undefined,
          completedAtUtc: new Date(task.completed_at).toISOString(),
          url: `https://app.todoist.com/app/task/${task.id}`,
        })),
      );
      cursor = payload.next_cursor ?? null;
    } while (cursor);

    return results;
  }
}

function compareTaskSummaries(left: DailyTaskSummary, right: DailyTaskSummary) {
  return (
    left.dueSortKey.localeCompare(right.dueSortKey) ||
    right.priority - left.priority ||
    left.title.localeCompare(right.title)
  );
}

function classifyTodoistTask(
  task: TodoistTaskResponse,
  todayDate: string,
  endExclusiveDate: string,
  timezone: string,
): { kind: 'overdue' | 'today'; label: string; sortKey: string; dateKey: string } | null {
  const due = task.due;

  if (!due) {
    return null;
  }

  if (due.datetime) {
    const dueDate = new Date(due.datetime);
    const localDate = getLocalDateParts(dueDate, timezone).date;
    const timeLabel = formatLocalTime(dueDate, timezone);

    if (localDate < todayDate) {
      return {
        kind: 'overdue',
        dateKey: localDate,
        label: `Overdue since ${localDate} ${timeLabel}`,
        sortKey: dueDate.toISOString(),
      };
    }

    if (localDate >= todayDate && localDate < endExclusiveDate) {
      return {
        kind: 'today',
        dateKey: localDate,
        label: localDate === todayDate ? `Due at ${timeLabel}` : `${localDate} at ${timeLabel}`,
        sortKey: dueDate.toISOString(),
      };
    }

    return null;
  }

  if (due.date) {
    if (due.date < todayDate) {
      return {
        kind: 'overdue',
        dateKey: due.date,
        label: `Overdue since ${due.date}`,
        sortKey: `${due.date}T00:00:00.000Z`,
      };
    }

    if (due.date >= todayDate && due.date < endExclusiveDate) {
      return {
        kind: 'today',
        dateKey: due.date,
        label: due.date === todayDate ? 'Due today' : `Due ${due.date}`,
        sortKey: `${due.date}T23:59:59.999Z`,
      };
    }
  }

  return null;
}

function buildTodoistDateFilter(days: number) {
  if (days <= 1) {
    return 'today | overdue';
  }

  return `overdue | next ${days} days`;
}

function mapTaskRecord(
  task: TodoistTaskResponse,
  todayDate: string,
  endExclusiveDate: string,
  timezone: string,
  projectName?: string,
): TodoistTaskRecord | null {
  const classification = classifyTodoistTask(task, todayDate, endExclusiveDate, timezone);

  if (!classification) {
    return null;
  }

  return {
    id: task.id,
    title: task.content,
    normalizedTitle: normalizeTaskTitle(task.content),
    priority: task.priority,
    projectId: task.project_id ?? undefined,
    projectName,
    dueLabel: classification.label,
    dueDate: classification.dateKey,
    dueDateTimeUtc: task.due?.datetime ? new Date(task.due.datetime).toISOString() : undefined,
    dueString: task.due?.string ?? undefined,
    labels: task.labels ?? undefined,
    url: task.url ?? `https://app.todoist.com/app/task/${task.id}`,
    taskStatus: 'active',
  };
}

function mapActiveTaskRecord(
  task: TodoistTaskResponse,
  timezone: string,
  projectName?: string,
): TodoistTaskRecord {
  const dueLabel = task.due?.datetime
    ? `Due at ${formatLocalTime(new Date(task.due.datetime), timezone)}`
    : task.due?.date
      ? `Due ${task.due.date}`
      : undefined;

  const dueDate = task.due?.datetime
    ? getLocalDateParts(new Date(task.due.datetime), timezone).date
    : task.due?.date;

  return {
    id: task.id,
    title: task.content,
    normalizedTitle: normalizeTaskTitle(task.content),
    priority: task.priority,
    recurring: task.due?.is_recurring ?? false,
    projectId: task.project_id ?? undefined,
    projectName,
    sectionId: task.section_id ?? undefined,
    parentId: task.parent_id ?? undefined,
    orderIndex: task.child_order ?? task.order ?? undefined,
    createdAtUtc: task.created_at ? new Date(task.created_at).toISOString() : undefined,
    updatedAtUtc: task.created_at ? new Date(task.created_at).toISOString() : undefined,
    dueLabel,
    dueDate,
    dueDateTimeUtc: task.due?.datetime ? new Date(task.due.datetime).toISOString() : undefined,
    dueString: task.due?.string ?? undefined,
    labels: task.labels ?? undefined,
    url: task.url ?? `https://app.todoist.com/app/task/${task.id}`,
    taskStatus: 'active',
  };
}

function mapCompletedTaskSummary(
  task: TodoistCompletedTaskRecord,
  timezone: string,
  projectName?: string,
): CompletedTaskSummary {
  return {
    id: task.id,
    title: task.title,
    priority: task.priority,
    projectId: task.projectId,
    projectName,
    completedAtUtc: task.completedAtUtc,
    completedLabel: `Done at ${formatLocalTime(new Date(task.completedAtUtc), timezone)}`,
    completedSortKey: task.completedAtUtc,
    labels: undefined,
    url: task.url,
  };
}

function addDays(dateString: string, days: number): string {
  const match = dateString.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    throw new Error(`Invalid ISO date: ${dateString}`);
  }

  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return date.toISOString().slice(0, 10);
}
