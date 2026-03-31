import { createOperatorServiceForScript } from '../app/admin/operator-service-factory';
import { isJsonOutputRequested, printOutput } from './admin-output';

async function main() {
  const { operatorService } = createOperatorServiceForScript('admin-reminders-retry-failed');
  const json = isJsonOutputRequested();
  const result = await operatorService.retryFailedReminders();
  const lines = [
    'Reminder retry completed.',
    `Failed jobs reset: ${result.retriedCount}`,
    `Pending now: ${result.summary.pendingCount}`,
    `Failed now: ${result.summary.failedCount}`,
  ];

  printOutput(result, lines, json);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
