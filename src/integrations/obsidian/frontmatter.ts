export interface ParsedObsidianTaskNote {
  frontmatter: Record<string, boolean | number | string | string[] | null>;
  body: string;
}

export interface ParsedObsidianWritableFields {
  title: string;
  completed: boolean;
  priorityApi: number;
  project?: string;
  labels: string[];
  dueDate?: string;
  dueDatetime?: string;
}

export function parseObsidianTaskNote(markdown: string): ParsedObsidianTaskNote {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);

  if (!match) {
    throw new Error('Task note is missing YAML frontmatter.');
  }

  return {
    frontmatter: parseSimpleYaml(match[1] ?? ''),
    body: (match[2] ?? '').replace(/^\n/, ''),
  };
}

export function parseWritableFields(frontmatter: Record<string, boolean | number | string | string[] | null>): ParsedObsidianWritableFields {
  const title = requireString(frontmatter.title, 'title');
  const completed = requireBoolean(frontmatter.completed, 'completed');
  const priorityApi = requireNumber(frontmatter.priority_api, 'priority_api');
  const project = optionalString(frontmatter.project);
  const labels = requireStringList(frontmatter.labels, 'labels');
  const dueDate = optionalString(frontmatter.due_date);
  const dueDatetime = optionalString(frontmatter.due_datetime);

  if (priorityApi < 1 || priorityApi > 4) {
    throw new Error('priority_api must be between 1 and 4.');
  }

  if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    throw new Error('due_date must use YYYY-MM-DD.');
  }

  if (dueDatetime && Number.isNaN(Date.parse(dueDatetime))) {
    throw new Error('due_datetime must be an ISO datetime.');
  }

  return {
    title,
    completed,
    priorityApi,
    project: project ?? undefined,
    labels: [...labels].sort((left, right) => left.localeCompare(right)),
    dueDate: dueDate ?? undefined,
    dueDatetime: dueDatetime ?? undefined,
  };
}

function parseSimpleYaml(frontmatter: string) {
  const result: Record<string, boolean | number | string | string[] | null> = {};
  const lines = frontmatter.split('\n');

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (!line || line.trim().length === 0) {
      continue;
    }

    const match = line.match(/^([A-Za-z0-9_]+):(?:\s(.*))?$/);

    if (!match) {
      throw new Error(`Unsupported frontmatter line: ${line}`);
    }

    const key = match[1];
    const inlineValue = match[2];

    if (!key) {
      throw new Error(`Unsupported frontmatter line: ${line}`);
    }

    if (inlineValue === undefined || inlineValue.length === 0) {
      const items: string[] = [];

      while (index + 1 < lines.length) {
        const nextLine = lines[index + 1];

        if (!nextLine?.startsWith('  - ')) {
          break;
        }

        index += 1;
        items.push(parseYamlScalar(nextLine.slice(4)) as string);
      }

      result[key] = items.length > 0 ? items : null;
      continue;
    }

    result[key] = parseYamlScalar(inlineValue);
  }

  return result;
}

function parseYamlScalar(rawValue: string) {
  const value = rawValue.trim();

  if (value === 'null') {
    return null;
  }

  if (value === '[]') {
    return [];
  }

  if (value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  if (/^-?\d+$/.test(value)) {
    return Number(value);
  }

  if (value.startsWith('"') && value.endsWith('"')) {
    return JSON.parse(value) as string;
  }

  return value;
}

function requireString(value: boolean | number | string | string[] | null | undefined, field: string) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string.`);
  }

  return value.trim();
}

function optionalString(value: boolean | number | string | string[] | null | undefined) {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (Array.isArray(value) && value.length === 0) {
    return undefined;
  }

  if (typeof value !== 'string') {
    throw new Error('Expected a string value.');
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function requireBoolean(value: boolean | number | string | string[] | null | undefined, field: string) {
  if (typeof value !== 'boolean') {
    throw new Error(`${field} must be a boolean.`);
  }

  return value;
}

function requireNumber(value: boolean | number | string | string[] | null | undefined, field: string) {
  if (typeof value !== 'number') {
    throw new Error(`${field} must be a number.`);
  }

  return value;
}

function requireStringList(value: boolean | number | string | string[] | null | undefined, field: string) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${field} must be a list of strings.`);
  }

  return value.map((item) => item.trim()).filter((item) => item.length > 0);
}
