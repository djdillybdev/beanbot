export type TaskStatus = 'active' | 'completed' | 'deleted';

export interface TodoistTaskRecord {
  id: string;
  title: string;
  normalizedTitle: string;
  priority: number;
  projectId?: string;
  projectName?: string;
  dueLabel?: string;
  dueDate?: string;
  dueDateTimeUtc?: string;
  dueString?: string;
  labels?: string[];
  url: string;
  taskStatus: TaskStatus;
}

export interface TaskCommandResult {
  task: TodoistTaskRecord;
}

export interface TaskCompletionResolution {
  matches: TodoistTaskRecord[];
  query: string;
}

export interface TaskAutocompleteSuggestion {
  name: string;
  value: string;
}

export interface TaskCreateInput {
  content: string;
  due?: string;
  priority?: 1 | 2 | 3 | 4;
  projectId?: string;
  labels?: string[];
}

export interface TaskEditInput {
  content?: string;
  dueString?: string;
  priority?: 1 | 2 | 3 | 4;
  projectName?: string;
  labels?: string[];
}

export interface TodoistProjectRecord {
  id: string;
  name: string;
  isInboxProject?: boolean;
}

export interface ProjectAutocompleteSuggestion {
  name: string;
  value: string;
}
