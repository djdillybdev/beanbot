import type { AppConfig } from '../../config';
import type { Database } from '../../db/types';
import { TodoistClient } from '../../integrations/todoist/client';
import type { Logger } from '../../logging/logger';
import { SubsystemHealthRegistry } from '../../runtime/subsystem-health';
import { createObsidianSyncContext } from './obsidian-sync-context';
import type { ObsidianResetFromTodoistResult } from './obsidian-sync-service';

export interface ObsidianSyncRuntime {
  stop(): void;
  runOnceNow(): Promise<void>;
  resetFromTodoist(): Promise<ObsidianResetFromTodoistResult>;
}

const INITIAL_RETRY_DELAY_MS = 5_000;
const MAX_RETRY_DELAY_MS = 5 * 60_000;

export async function startObsidianSyncRuntime(
  config: AppConfig,
  db: Database,
  todoistClient: TodoistClient,
  logger: Logger,
  healthRegistry: SubsystemHealthRegistry,
): Promise<ObsidianSyncRuntime> {
  const runtimeLogger = logger.child({ subsystem: 'obsidian-sync' });
  const subsystemName = 'obsidian-sync';

  if (!config.obsidianVaultPath) {
    runtimeLogger.info('Obsidian sync disabled because OBSIDIAN_VAULT_PATH is not configured.');
    healthRegistry.markDisabled(subsystemName, 'OBSIDIAN_VAULT_PATH is not configured.');
    return {
      stop() {},
      async runOnceNow() {},
      async resetFromTodoist() {
        throw new Error('OBSIDIAN_VAULT_PATH is required for Obsidian sync.');
      },
    };
  }

  const { syncService, syncStateRepository } = createObsidianSyncContext(
    config,
    db,
    todoistClient,
    runtimeLogger,
  );

  let isRunning = false;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let retryCount = 0;

  const scheduleNext = (delayMs: number) => {
    if (stopped) {
      return;
    }

    if (timer) {
      clearTimeout(timer);
    }

    timer = setTimeout(() => {
      void runPass('scheduled');
    }, delayMs);
  };

  const updateHealthyMetadata = async () => {
    const state = await syncStateRepository.getState();
    healthRegistry.markHealthy(subsystemName, 'Obsidian sync is healthy.', {
      pollIntervalSeconds: config.obsidianSyncPollIntervalSeconds,
      vaultPath: config.obsidianVaultPath,
      tasksPath: config.obsidianTasksPath,
      lastFullSyncAtUtc: state?.lastFullSyncAtUtc ?? null,
      lastIncrementalSyncAtUtc: state?.lastIncrementalSyncAtUtc ?? null,
      lastVaultScanAtUtc: state?.lastVaultScanAtUtc ?? null,
    });
  };

  const runPass = async (reason: 'startup' | 'scheduled' | 'manual') => {
    if (isRunning) {
      runtimeLogger.warn('Skipping Obsidian sync pass because the previous pass is still running.');
      return;
    }

    isRunning = true;
    try {
      healthRegistry.markStarting(subsystemName, `Running Obsidian sync pass (${reason}).`, {
        retryCount,
      });
      await syncService.runOnce();
      retryCount = 0;
      await updateHealthyMetadata();
      scheduleNext(config.obsidianSyncPollIntervalSeconds * 1000);
    } finally {
      isRunning = false;
    }
  };

  const handleRetry = (error: unknown) => {
    retryCount += 1;
    const delayMs = Math.min(
      INITIAL_RETRY_DELAY_MS * 2 ** Math.max(retryCount - 1, 0),
      MAX_RETRY_DELAY_MS,
    );
    const nextRetryAtUtc = new Date(Date.now() + delayMs).toISOString();
    healthRegistry.markDegraded(subsystemName, error, {
      retryCount,
      nextRetryAtUtc,
      pollIntervalSeconds: config.obsidianSyncPollIntervalSeconds,
      vaultPath: config.obsidianVaultPath,
      tasksPath: config.obsidianTasksPath,
    });
    runtimeLogger.error('Obsidian sync pass failed; scheduling retry', error, {
      retryCount,
      nextRetryAtUtc,
    });
    scheduleNext(delayMs);
  };

  const executeManagedPass = async (reason: 'startup' | 'scheduled') => {
    try {
      await runPass(reason);
      if (reason === 'startup') {
        runtimeLogger.info('Obsidian sync runner started', {
          pollIntervalSeconds: config.obsidianSyncPollIntervalSeconds,
          vaultPath: config.obsidianVaultPath,
          tasksPath: config.obsidianTasksPath,
        });
      }
    } catch (error) {
      handleRetry(error);
    }
  };

  void executeManagedPass('startup');

  return {
    stop() {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
    async runOnceNow() {
      try {
        await runPass('manual');
      } catch (error) {
        handleRetry(error);
        throw error;
      }
    },
    async resetFromTodoist() {
      if (isRunning) {
        throw new Error('Cannot reset Obsidian sync while a sync pass is already running.');
      }

      isRunning = true;
      try {
        healthRegistry.markStarting(subsystemName, 'Resetting Obsidian sync state from Todoist.', {
          retryCount,
        });
        const result = await syncService.resetFromTodoist();
        retryCount = 0;
        await updateHealthyMetadata();
        scheduleNext(config.obsidianSyncPollIntervalSeconds * 1000);
        return result;
      } catch (error) {
        handleRetry(error);
        throw error;
      } finally {
        isRunning = false;
      }
    },
  };
}
