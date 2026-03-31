import type { ObsidianResolveAction } from '../app/admin/operator-service';
import { createOperatorServiceForScript } from '../app/admin/operator-service-factory';
import { isJsonOutputRequested, printOutput } from './admin-output';

async function main() {
  const { operatorService } = createOperatorServiceForScript('admin-obsidian-resolve');
  const json = isJsonOutputRequested();
  const args = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  const taskId = args[0];
  const action = args[1] as ObsidianResolveAction | undefined;

  if (!taskId || !action) {
    throw new Error('Usage: bun run admin:obsidian:resolve <task_id> <retry-push|retry-delete|re-export> [--json]');
  }

  const result = await operatorService.resolveObsidianConflict(taskId, action);
  const lines = [
    'Obsidian repair completed.',
    `Task id: ${result.taskId}`,
    `Action: ${result.requestedAction}`,
    `Conflict kind: ${result.conflictKind}`,
  ];

  printOutput(result, lines, json);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
