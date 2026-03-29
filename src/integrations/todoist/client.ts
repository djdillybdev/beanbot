import type { AppConfig } from '../../config';
import type { DailyTaskSummary } from '../../domain/daily-review';
import type { StoredOAuthToken } from '../../domain/oauth';
import { getLocalDateParts, formatLocalTime } from '../../utils/time';
import { OAuthTokenRepository } from '../../db/oauth-token-repository';

const TODOIST_API_BASE_URL = 'https://api.todoist.com/api/v1';

interface TodoistTaskResponse {
  id: string;
  content: string;
  priority: number;
  due?: {
    date?: string;
    datetime?: string;
    string?: string;
  } | null;
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

  async getTasksForUpcomingDays(
    days: number,
  ): Promise<{ overdueTasks: DailyTaskSummary[]; dueTodayTasks: DailyTaskSummary[] }> {
    const token = await this.requireToken();
    const tasks = await this.fetchFilteredTasks(token, buildTodoistDateFilter(days));
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
        dueLabel: classification.label,
        dueSortKey: classification.sortKey,
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

function addDays(dateString: string, days: number): string {
  const match = dateString.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    throw new Error(`Invalid ISO date: ${dateString}`);
  }

  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return date.toISOString().slice(0, 10);
}
