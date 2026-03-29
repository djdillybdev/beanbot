export interface TodoistTaskRecord {
  id: string;
  title: string;
  normalizedTitle: string;
  priority: number;
  dueLabel?: string;
  dueDate?: string;
  url: string;
  isActive: boolean;
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
