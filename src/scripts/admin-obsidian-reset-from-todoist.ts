import { createOperatorServiceForScript } from '../app/admin/operator-service-factory';
import { isJsonOutputRequested, printOutput } from './admin-output';

async function main() {
  const args = process.argv.slice(2);
  const json = isJsonOutputRequested(args);
  const confirmed = args.includes('--confirm');
  const includeTaskCache = args.includes('--include-task-cache');

  if (!confirmed) {
    throw new Error(
      'Usage: bun run admin:obsidian:reset-from-todoist --confirm [--include-task-cache] [--json]',
    );
  }

  const { operatorService } = createOperatorServiceForScript('admin-obsidian-reset-from-todoist');
  const result = await operatorService.resetObsidianFromTodoist({ includeTaskCache });
  const lines = [
    'Obsidian reset from Todoist completed.',
    `Tracked notes: ${result.trackedNoteCount}`,
    `Deleted tracked notes: ${result.deletedNoteCount}`,
    `Missing tracked notes: ${result.missingTrackedNoteCount}`,
    `Skipped untracked notes: ${result.skippedUntrackedNoteCount}`,
    `Imported Todoist tasks: ${result.importedTaskCount}`,
    `Exported task notes: ${result.exportedTaskCount}`,
    `Written task notes: ${result.wroteFileCount}`,
    `Task cache reset: ${result.includeTaskCache}`,
    `Task cache rebuilt: ${result.taskCacheRebuiltCount}`,
    `Duration: ${result.totalDurationMs}ms`,
  ];

  printOutput(result, lines, json);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
