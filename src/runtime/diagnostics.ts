import type { MigrationRunResult } from '../db/migrate';
import type { RuntimeHealthSnapshot, SubsystemSnapshot } from './subsystem-health';

export interface ProviderStatus {
  connected: boolean;
  status: 'connected' | 'disconnected';
}

export interface OverallRuntimeSummary {
  status: RuntimeHealthSnapshot['status'];
  startupComplete: boolean;
  degradedSubsystemCount: number;
  failedSubsystemCount: number;
  disabledSubsystemCount: number;
  startingSubsystemCount: number;
  healthySubsystemCount: number;
  degradedSubsystems: string[];
  failedSubsystems: string[];
}

export interface TimestampDiagnostics {
  ageSeconds: number | null;
  ageLabel: string;
}

export function buildOverallRuntimeSummary(snapshot: RuntimeHealthSnapshot): OverallRuntimeSummary {
  const subsystems = Object.values(snapshot.subsystems);

  return {
    status: snapshot.status,
    startupComplete: snapshot.startupComplete,
    degradedSubsystemCount: subsystems.filter((entry) => entry.state === 'degraded').length,
    failedSubsystemCount: subsystems.filter((entry) => entry.state === 'failed').length,
    disabledSubsystemCount: subsystems.filter((entry) => entry.state === 'disabled').length,
    startingSubsystemCount: subsystems.filter((entry) => entry.state === 'starting').length,
    healthySubsystemCount: subsystems.filter((entry) => entry.state === 'healthy').length,
    degradedSubsystems: subsystems
      .filter((entry) => entry.state === 'degraded')
      .map((entry) => entry.name),
    failedSubsystems: subsystems
      .filter((entry) => entry.state === 'failed')
      .map((entry) => entry.name),
  };
}

export function buildProviderStatus(connected: boolean): ProviderStatus {
  return {
    connected,
    status: connected ? 'connected' : 'disconnected',
  };
}

export function buildRecencyDiagnostics(
  timestamp: string | null | undefined,
  now = new Date(),
): TimestampDiagnostics {
  const ageSeconds = getAgeSeconds(timestamp, now);

  return {
    ageSeconds,
    ageLabel: formatAgeSeconds(ageSeconds),
  };
}

export function enrichLatestUpdateSummary<T extends { latestUpdatedAtUtc: string | null }>(
  summary: T,
  staleAfterSeconds: number,
  now = new Date(),
) {
  const recency = buildRecencyDiagnostics(summary.latestUpdatedAtUtc, now);

  return {
    ...summary,
    latestUpdatedAgeSeconds: recency.ageSeconds,
    latestUpdatedAgeLabel: recency.ageLabel,
    freshness: summary.latestUpdatedAtUtc === null
      ? 'empty'
      : recency.ageSeconds !== null && recency.ageSeconds > staleAfterSeconds
        ? 'stale'
        : 'current',
  } as const;
}

export function buildReminderDiagnostics(
  summary: {
    totalCount: number;
    pendingCount: number;
    failedCount: number;
    duePendingCount: number;
    latestUpdatedAtUtc: string | null;
  },
  now = new Date(),
) {
  const enriched = enrichLatestUpdateSummary(summary, 60 * 30, now);

  return {
    ...enriched,
    status: summary.failedCount > 0
      ? 'degraded'
      : summary.duePendingCount > 0
        ? 'backlog'
        : 'healthy',
  } as const;
}

export function buildHabitDiagnostics(
  summary: {
    totalCount: number;
    activeCount: number;
    unparsedActiveCount: number;
    latestUpdatedAtUtc: string | null;
  },
  now = new Date(),
) {
  const enriched = enrichLatestUpdateSummary(summary, 60 * 30, now);

  return {
    ...enriched,
    status: summary.unparsedActiveCount > 0 ? 'needs_review' : 'healthy',
  } as const;
}

export function buildObsidianDiagnostics(
  state: {
    lastFullSyncAtUtc?: string | null;
    lastIncrementalSyncAtUtc?: string | null;
    lastVaultScanAtUtc?: string | null;
    lastIncrementalCursor?: string | null;
  } | null,
  options: {
    enabled: boolean;
    pollIntervalSeconds: number;
    runtimeSubsystem?: SubsystemSnapshot;
    now?: Date;
  },
) {
  const now = options.now ?? new Date();
  const lastFullSync = buildRecencyDiagnostics(state?.lastFullSyncAtUtc ?? null, now);
  const lastIncrementalSync = buildRecencyDiagnostics(state?.lastIncrementalSyncAtUtc ?? null, now);
  const lastVaultScan = buildRecencyDiagnostics(state?.lastVaultScanAtUtc ?? null, now);
  const maxHealthyAgeSeconds = Math.max(options.pollIntervalSeconds * 2, 60);
  const runtimeState = options.runtimeSubsystem?.state;

  const status = !options.enabled
    ? 'disabled'
    : runtimeState === 'failed'
      ? 'failed'
      : runtimeState === 'degraded'
        ? 'degraded'
        : lastIncrementalSync.ageSeconds === null
          ? 'waiting_for_first_sync'
          : lastIncrementalSync.ageSeconds > maxHealthyAgeSeconds
            ? 'stale'
            : 'healthy';

  return {
    enabled: options.enabled,
    status,
    lastFullSyncAtUtc: state?.lastFullSyncAtUtc ?? null,
    lastFullSyncAgeSeconds: lastFullSync.ageSeconds,
    lastFullSyncAgeLabel: lastFullSync.ageLabel,
    lastIncrementalSyncAtUtc: state?.lastIncrementalSyncAtUtc ?? null,
    lastIncrementalSyncAgeSeconds: lastIncrementalSync.ageSeconds,
    lastIncrementalSyncAgeLabel: lastIncrementalSync.ageLabel,
    lastVaultScanAtUtc: state?.lastVaultScanAtUtc ?? null,
    lastVaultScanAgeSeconds: lastVaultScan.ageSeconds,
    lastVaultScanAgeLabel: lastVaultScan.ageLabel,
    lastIncrementalCursorPresent: Boolean(state?.lastIncrementalCursor),
  } as const;
}

export function buildMigrationRuntimeSummary(result: MigrationRunResult) {
  return {
    status: result.verification.issuesRemaining.length === 0 ? 'healthy' : 'degraded',
    databasePath: result.databasePath,
    verificationIssueCount: result.verification.issuesDetected.length,
    verificationIssues: result.verification.issuesDetected,
    issueCount: result.verification.issuesRemaining.length,
    issues: result.verification.issuesRemaining,
    repairCount: result.repairsApplied.length,
    repairsApplied: result.repairsApplied,
  } as const;
}

export function formatAgeSeconds(ageSeconds: number | null) {
  if (ageSeconds === null) {
    return 'never';
  }

  if (ageSeconds < 60) {
    return `${ageSeconds}s`;
  }

  if (ageSeconds < 60 * 60) {
    return `${Math.floor(ageSeconds / 60)}m`;
  }

  if (ageSeconds < 60 * 60 * 24) {
    return `${Math.floor(ageSeconds / (60 * 60))}h`;
  }

  return `${Math.floor(ageSeconds / (60 * 60 * 24))}d`;
}

export function formatTimestampWithAge(
  timestamp: string | null | undefined,
  now = new Date(),
) {
  if (!timestamp) {
    return 'never';
  }

  const { ageLabel } = buildRecencyDiagnostics(timestamp, now);
  return `${timestamp} (${ageLabel} ago)`;
}

export async function fetchRuntimeHealth(baseUrl: string, timeoutMs = 1_500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(new URL('/health', baseUrl), {
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Health request failed with status ${response.status}.`);
    }

    return await response.json() as Record<string, unknown>;
  } finally {
    clearTimeout(timer);
  }
}

function getAgeSeconds(
  timestamp: string | null | undefined,
  now = new Date(),
) {
  if (!timestamp) {
    return null;
  }

  const millis = Date.parse(timestamp);

  if (Number.isNaN(millis)) {
    return null;
  }

  return Math.max(0, Math.floor((now.getTime() - millis) / 1000));
}
