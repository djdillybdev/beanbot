import { inspect } from 'node:util';

import type { Client, TextChannel } from 'discord.js';

import { resolveTextChannel } from '../jobs/resolve-text-channel';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogMetadata = Record<string, unknown>;

export interface Logger {
  debug(message: string, metadata?: LogMetadata): void;
  info(message: string, metadata?: LogMetadata): void;
  warn(message: string, metadata?: LogMetadata): void;
  error(message: string, error?: unknown, metadata?: LogMetadata): void;
  child(metadata: LogMetadata): Logger;
  attachDiscordChannel(client: Client, channelId: string, envName: string): Promise<void>;
}

interface ConsoleLike {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

interface LoggerOptions {
  consoleLevel: LogLevel;
  discordLevel: LogLevel;
  consoleLike?: ConsoleLike;
}

interface LogEvent {
  timestamp: string;
  level: LogLevel;
  message: string;
  metadata: LogMetadata;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

interface SharedLoggerState {
  consoleLevel: LogLevel;
  discordLevel: LogLevel;
  consoleLike: ConsoleLike;
  discordChannel: TextChannel | null;
  discordQueue: Promise<void>;
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const REDACTED_KEYS = new Set([
  'accessToken',
  'refreshToken',
  'token',
  'authorization',
  'clientSecret',
  'secret',
  'code',
  'state',
]);

export function createLogger(options: LoggerOptions): Logger {
  return new RuntimeLogger({
    consoleLevel: options.consoleLevel,
    discordLevel: options.discordLevel,
    consoleLike: options.consoleLike ?? console,
    discordChannel: null,
    discordQueue: Promise.resolve(),
  });
}

export function parseLogLevel(value: string | undefined, fallback: LogLevel): LogLevel {
  switch (value?.toLowerCase()) {
    case 'debug':
    case 'info':
    case 'warn':
    case 'error':
      return value.toLowerCase() as LogLevel;
    default:
      return fallback;
  }
}

class RuntimeLogger implements Logger {
  constructor(
    private readonly shared: SharedLoggerState,
    private readonly context: LogMetadata = {},
  ) {}

  child(metadata: LogMetadata): Logger {
    return new RuntimeLogger(this.shared, mergeMetadata(this.context, metadata));
  }

  async attachDiscordChannel(client: Client, channelId: string, envName: string): Promise<void> {
    this.shared.discordChannel = await resolveTextChannel(client, channelId, envName);
    this.info('Attached Discord log channel', { channelId });
  }

  debug(message: string, metadata?: LogMetadata): void {
    this.log('debug', message, undefined, metadata);
  }

  info(message: string, metadata?: LogMetadata): void {
    this.log('info', message, undefined, metadata);
  }

  warn(message: string, metadata?: LogMetadata): void {
    this.log('warn', message, undefined, metadata);
  }

  error(message: string, error?: unknown, metadata?: LogMetadata): void {
    this.log('error', message, error, metadata);
  }

  private log(level: LogLevel, message: string, error?: unknown, metadata?: LogMetadata) {
    const event = buildLogEvent(level, message, mergeMetadata(this.context, metadata), error);

    if (shouldLog(level, this.shared.consoleLevel)) {
      this.writeConsole(event);
    }

    if (shouldLog(level, this.shared.discordLevel) && this.shared.discordChannel) {
      this.queueDiscordSend(event);
    }
  }

  private writeConsole(event: LogEvent) {
    const line = formatConsoleLine(event);

    if (event.level === 'debug') {
      this.shared.consoleLike.debug(line);
      return;
    }

    if (event.level === 'info') {
      this.shared.consoleLike.info(line);
      return;
    }

    if (event.level === 'warn') {
      this.shared.consoleLike.warn(line);
      return;
    }

    this.shared.consoleLike.error(line);
  }

  private queueDiscordSend(event: LogEvent) {
    const channel = this.shared.discordChannel;

    if (!channel) {
      return;
    }

    this.shared.discordQueue = this.shared.discordQueue
      .then(async () => {
        await channel.send({ content: formatDiscordLine(event) });
      })
      .catch((sendError) => {
        this.writeConsoleDirect(
          'error',
          `Failed to send log entry to Discord: ${getErrorMessage(sendError)}`,
        );
      });
  }

  private writeConsoleDirect(level: 'warn' | 'error', message: string) {
    const line = `[${new Date().toISOString()}] ${level.toUpperCase()} logger ${message}`;

    if (level === 'warn') {
      this.shared.consoleLike.warn(line);
      return;
    }

    this.shared.consoleLike.error(line);
  }
}

function buildLogEvent(
  level: LogLevel,
  message: string,
  metadata: LogMetadata,
  error?: unknown,
): LogEvent {
  return {
    timestamp: new Date().toISOString(),
    level,
    message,
    metadata,
    error: error ? serializeError(error) : undefined,
  };
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    name: 'Error',
    message: String(error),
  };
}

function mergeMetadata(left: LogMetadata, right?: LogMetadata) {
  return right ? { ...left, ...right } : { ...left };
}

function shouldLog(level: LogLevel, threshold: LogLevel) {
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[threshold];
}

function formatConsoleLine(event: LogEvent) {
  const parts = [`[${event.timestamp}]`, event.level.toUpperCase(), event.message];
  const metadata = sanitizeMetadata(event.metadata, false) as LogMetadata;

  if (Object.keys(metadata).length > 0) {
    parts.push(inspect(metadata, { depth: 5, breakLength: 120, compact: true }));
  }

  if (event.error) {
    parts.push(`${event.error.name}: ${event.error.message}`);
    if (event.error.stack) {
      parts.push(event.error.stack);
    }
  }

  return parts.join(' ');
}

function formatDiscordLine(event: LogEvent) {
  const safeMetadata = sanitizeMetadata(event.metadata, true) as LogMetadata;
  const metadataSummary = Object.keys(safeMetadata).length > 0
    ? `\n${inspect(safeMetadata, { depth: 3, breakLength: 100, compact: true })}`
    : '';
  const errorSummary = event.error
    ? `\n${event.error.name}: ${event.error.message}`
    : '';
  const base = `**${event.level.toUpperCase()}** ${event.message}${metadataSummary}${errorSummary}`;

  return truncateDiscordContent(base);
}

function sanitizeMetadata(value: unknown, discordSafe: boolean, key?: string): unknown {
  if (key && REDACTED_KEYS.has(key)) {
    return '[redacted]';
  }

  if (value === null || value === undefined) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, discordSafe ? 10 : value.length).map((item) => sanitizeMetadata(item, discordSafe));
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
    };
  }

  if (typeof value === 'object') {
    const objectValue = value as Record<string, unknown>;
    const entries = Object.entries(objectValue)
      .filter(([, nestedValue]) => nestedValue !== undefined)
      .map(([nestedKey, nestedValue]) => [
        nestedKey,
        sanitizeMetadata(normalizeSensitiveField(nestedKey, nestedValue), discordSafe, nestedKey),
      ]);

    return Object.fromEntries(entries);
  }

  if (typeof value === 'string') {
    return discordSafe ? summarizeString(value, key) : value;
  }

  return value;
}

function normalizeSensitiveField(key: string, value: unknown) {
  if (key === 'text' || key === 'content') {
    if (typeof value !== 'string') {
      return value;
    }

    return {
      length: value.length,
      preview: value.length > 0 ? summarizeString(value, key) : '',
    };
  }

  return value;
}

function summarizeString(value: string, key?: string) {
  if (key === 'text' || key === 'content') {
    return `[${value.length} chars]`;
  }

  if (value.length <= 120) {
    return value;
  }

  return `${value.slice(0, 117)}...`;
}

function truncateDiscordContent(value: string) {
  if (value.length <= 1900) {
    return value;
  }

  return `${value.slice(0, 1897)}...`;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
