export type SubsystemState = 'disabled' | 'starting' | 'healthy' | 'degraded' | 'failed';

export interface SubsystemSnapshot {
  name: string;
  state: SubsystemState;
  summary?: string;
  startedAtUtc?: string;
  lastHealthyAtUtc?: string;
  lastFailureAtUtc?: string;
  lastTransitionAtUtc: string;
  retryCount: number;
  nextRetryAtUtc?: string;
  metadata?: Record<string, unknown>;
}

export interface RuntimeHealthSnapshot {
  status: 'healthy' | 'degraded' | 'failed';
  startedAtUtc: string;
  startupComplete: boolean;
  subsystems: Record<string, SubsystemSnapshot>;
}

export class SubsystemHealthRegistry {
  private readonly startedAtUtc = new Date().toISOString();
  private startupComplete = false;
  private readonly subsystems = new Map<string, SubsystemSnapshot>();

  setStartupComplete(value = true) {
    this.startupComplete = value;
  }

  markStarting(name: string, summary?: string, metadata?: Record<string, unknown>) {
    const existing = this.subsystems.get(name);
    this.subsystems.set(name, {
      name,
      state: 'starting',
      summary,
      startedAtUtc: existing?.startedAtUtc ?? new Date().toISOString(),
      lastHealthyAtUtc: existing?.lastHealthyAtUtc,
      lastFailureAtUtc: existing?.lastFailureAtUtc,
      lastTransitionAtUtc: new Date().toISOString(),
      retryCount: existing?.retryCount ?? 0,
      nextRetryAtUtc: undefined,
      metadata: mergeMetadata(existing?.metadata, metadata),
    });
  }

  markHealthy(name: string, summary?: string, metadata?: Record<string, unknown>) {
    const existing = this.subsystems.get(name);
    this.subsystems.set(name, {
      name,
      state: 'healthy',
      summary,
      startedAtUtc: existing?.startedAtUtc ?? new Date().toISOString(),
      lastHealthyAtUtc: new Date().toISOString(),
      lastFailureAtUtc: existing?.lastFailureAtUtc,
      lastTransitionAtUtc: new Date().toISOString(),
      retryCount: 0,
      nextRetryAtUtc: undefined,
      metadata: mergeMetadata(existing?.metadata, metadata),
    });
  }

  markDegraded(
    name: string,
    errorOrSummary?: unknown,
    metadata?: Record<string, unknown>,
  ) {
    const existing = this.subsystems.get(name);
    const summary = normalizeSummary(errorOrSummary);
    this.subsystems.set(name, {
      name,
      state: 'degraded',
      summary,
      startedAtUtc: existing?.startedAtUtc ?? new Date().toISOString(),
      lastHealthyAtUtc: existing?.lastHealthyAtUtc,
      lastFailureAtUtc: new Date().toISOString(),
      lastTransitionAtUtc: new Date().toISOString(),
      retryCount: metadata?.retryCount as number | undefined ?? existing?.retryCount ?? 0,
      nextRetryAtUtc: metadata?.nextRetryAtUtc as string | undefined ?? existing?.nextRetryAtUtc,
      metadata: mergeMetadata(existing?.metadata, metadata),
    });
  }

  markFailed(
    name: string,
    errorOrSummary?: unknown,
    metadata?: Record<string, unknown>,
  ) {
    const existing = this.subsystems.get(name);
    this.subsystems.set(name, {
      name,
      state: 'failed',
      summary: normalizeSummary(errorOrSummary),
      startedAtUtc: existing?.startedAtUtc ?? new Date().toISOString(),
      lastHealthyAtUtc: existing?.lastHealthyAtUtc,
      lastFailureAtUtc: new Date().toISOString(),
      lastTransitionAtUtc: new Date().toISOString(),
      retryCount: metadata?.retryCount as number | undefined ?? existing?.retryCount ?? 0,
      nextRetryAtUtc: undefined,
      metadata: mergeMetadata(existing?.metadata, metadata),
    });
  }

  markDisabled(name: string, summary?: string, metadata?: Record<string, unknown>) {
    const existing = this.subsystems.get(name);
    this.subsystems.set(name, {
      name,
      state: 'disabled',
      summary,
      startedAtUtc: existing?.startedAtUtc,
      lastHealthyAtUtc: existing?.lastHealthyAtUtc,
      lastFailureAtUtc: existing?.lastFailureAtUtc,
      lastTransitionAtUtc: new Date().toISOString(),
      retryCount: 0,
      nextRetryAtUtc: undefined,
      metadata: mergeMetadata(existing?.metadata, metadata),
    });
  }

  setMetadata(name: string, metadata: Record<string, unknown>) {
    const existing = this.subsystems.get(name);

    if (!existing) {
      this.subsystems.set(name, {
        name,
        state: 'starting',
        lastTransitionAtUtc: new Date().toISOString(),
        retryCount: 0,
        metadata,
      });
      return;
    }

    this.subsystems.set(name, {
      ...existing,
      metadata: mergeMetadata(existing.metadata, metadata),
    });
  }

  getSnapshot(): RuntimeHealthSnapshot {
    const subsystems = Object.fromEntries(
      [...this.subsystems.entries()].sort(([left], [right]) => left.localeCompare(right)),
    );

    return {
      status: this.computeOverallStatus(),
      startedAtUtc: this.startedAtUtc,
      startupComplete: this.startupComplete,
      subsystems,
    };
  }

  private computeOverallStatus(): RuntimeHealthSnapshot['status'] {
    const states = [...this.subsystems.values()].map((entry) => entry.state);

    if (states.includes('failed')) {
      return 'failed';
    }

    if (states.includes('degraded') || states.includes('starting') || !this.startupComplete) {
      return 'degraded';
    }

    return 'healthy';
  }
}

function normalizeSummary(value: unknown) {
  if (typeof value === 'string') {
    return value;
  }

  if (value instanceof Error) {
    return value.message;
  }

  if (value === undefined) {
    return undefined;
  }

  return String(value);
}

function mergeMetadata(
  left?: Record<string, unknown>,
  right?: Record<string, unknown>,
) {
  if (!left && !right) {
    return undefined;
  }

  return {
    ...(left ?? {}),
    ...(right ?? {}),
  };
}
