import { createOperatorServiceForScript } from '../app/admin/operator-service-factory';
import { isJsonOutputRequested, printOutput } from './admin-output';

async function main() {
  const { operatorService } = createOperatorServiceForScript('admin-obsidian-conflicts');
  const json = isJsonOutputRequested();
  const conflicts = await operatorService.listObsidianConflicts();
  const lines = conflicts.length === 0
    ? ['No tracked Obsidian conflicts or repair-needed tasks.']
    : [
        `Tracked Obsidian conflicts: ${conflicts.length}`,
        ...conflicts.map((conflict) =>
          `${conflict.taskId} ${conflict.kind} (${conflict.syncStatus})${conflict.recommendedAction ? ` -> ${conflict.recommendedAction}` : ''}`),
      ];

  printOutput({ conflicts }, lines, json);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
