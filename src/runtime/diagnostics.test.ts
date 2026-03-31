import { describe, expect, test } from 'bun:test';

import {
  buildHabitDiagnostics,
  buildMigrationRuntimeSummary,
  buildObsidianDiagnostics,
  buildOverallRuntimeSummary,
  buildReminderDiagnostics,
  enrichLatestUpdateSummary,
  formatAgeSeconds,
  formatTimestampWithAge,
} from './diagnostics';

describe('runtime diagnostics', () => {
  test('summarizes subsystem counts and names', () => {
    const summary = buildOverallRuntimeSummary({
      status: 'degraded',
      startedAtUtc: '2026-03-31T12:00:00.000Z',
      startupComplete: true,
      subsystems: {
        http: {
          name: 'http',
          state: 'healthy',
          lastTransitionAtUtc: '2026-03-31T12:00:00.000Z',
          retryCount: 0,
        },
        obsidian: {
          name: 'obsidian',
          state: 'degraded',
          lastTransitionAtUtc: '2026-03-31T12:00:00.000Z',
          retryCount: 2,
        },
        discord: {
          name: 'discord',
          state: 'failed',
          lastTransitionAtUtc: '2026-03-31T12:00:00.000Z',
          retryCount: 0,
        },
      },
    });

    expect(summary.degradedSubsystemCount).toBe(1);
    expect(summary.failedSubsystemCount).toBe(1);
    expect(summary.healthySubsystemCount).toBe(1);
    expect(summary.degradedSubsystems).toEqual(['obsidian']);
    expect(summary.failedSubsystems).toEqual(['discord']);
  });

  test('enriches cache summaries with freshness and age', () => {
    const summary = enrichLatestUpdateSummary(
      {
        totalCount: 10,
        latestUpdatedAtUtc: '2026-03-31T11:55:00.000Z',
      },
      60 * 30,
      new Date('2026-03-31T12:00:00.000Z'),
    );

    expect(summary.latestUpdatedAgeSeconds).toBe(300);
    expect(summary.latestUpdatedAgeLabel).toBe('5m');
    expect(summary.freshness).toBe('current');
  });

  test('marks reminder backlog and habit review state', () => {
    const reminders = buildReminderDiagnostics(
      {
        totalCount: 3,
        pendingCount: 2,
        failedCount: 0,
        duePendingCount: 1,
        latestUpdatedAtUtc: '2026-03-31T11:58:00.000Z',
      },
      new Date('2026-03-31T12:00:00.000Z'),
    );
    const habits = buildHabitDiagnostics(
      {
        totalCount: 4,
        activeCount: 3,
        unparsedActiveCount: 1,
        latestUpdatedAtUtc: '2026-03-31T11:50:00.000Z',
      },
      new Date('2026-03-31T12:00:00.000Z'),
    );

    expect(reminders.status).toBe('backlog');
    expect(habits.status).toBe('needs_review');
  });

  test('derives obsidian health from runtime state and sync ages', () => {
    const diagnostics = buildObsidianDiagnostics(
      {
        lastIncrementalSyncAtUtc: '2026-03-31T11:59:00.000Z',
        lastFullSyncAtUtc: '2026-03-31T11:00:00.000Z',
        lastVaultScanAtUtc: '2026-03-31T11:59:30.000Z',
        lastIncrementalCursor: 'cursor',
      },
      {
        enabled: true,
        pollIntervalSeconds: 300,
        runtimeSubsystem: {
          name: 'obsidian-sync',
          state: 'healthy',
          lastTransitionAtUtc: '2026-03-31T11:59:00.000Z',
          retryCount: 0,
        },
        now: new Date('2026-03-31T12:00:00.000Z'),
      },
    );

    expect(diagnostics.status).toBe('healthy');
    expect(diagnostics.lastIncrementalSyncAgeLabel).toBe('1m');
    expect(diagnostics.lastIncrementalCursorPresent).toBe(true);
  });

  test('summarizes migration repairs for runtime health', () => {
    const summary = buildMigrationRuntimeSummary({
      databasePath: '/tmp/beanbot.sqlite',
      repairsApplied: ['Added todoist_task_map.last_seen_recurring compatibility column.'],
      verification: {
        issuesDetected: ['todoist_task_map.last_seen_recurring is missing'],
        issuesRemaining: [],
      },
    });

    expect(summary.status).toBe('healthy');
    expect(summary.repairCount).toBe(1);
    expect(summary.verificationIssueCount).toBe(1);
  });

  test('formats ages and timestamps for operator output', () => {
    expect(formatAgeSeconds(null)).toBe('never');
    expect(formatAgeSeconds(45)).toBe('45s');
    expect(formatAgeSeconds(5 * 60)).toBe('5m');
    expect(
      formatTimestampWithAge(
        '2026-03-31T11:59:00.000Z',
        new Date('2026-03-31T12:00:00.000Z'),
      ),
    ).toBe('2026-03-31T11:59:00.000Z (1m ago)');
  });
});
