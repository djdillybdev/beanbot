import { createOperatorServiceForScript } from '../app/admin/operator-service-factory';
import { isJsonOutputRequested, printOutput } from './admin-output';

async function main() {
  const { operatorService } = createOperatorServiceForScript('admin-cache-rebuild');
  const json = isJsonOutputRequested();
  const target = (process.argv.slice(2).find((arg) => !arg.startsWith('--')) ?? 'all') as 'tasks' | 'events' | 'all';
  const result = await operatorService.rebuildCaches(target);
  const lines = [
    'Cache rebuild completed.',
    `Target: ${result.target}`,
    `Tasks rebuilt: ${result.taskCount}`,
    `Events rebuilt: ${result.eventCount}`,
    `Duration: ${result.durationMs}ms`,
  ];

  printOutput(result, lines, json);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
