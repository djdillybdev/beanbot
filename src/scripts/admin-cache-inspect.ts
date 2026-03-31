import { createConfig } from '../config';
import { createDb } from '../db/client';
import { CalendarEventMapRepository } from '../db/calendar-event-map-repository';
import { TodoistTaskMapRepository } from '../db/todoist-task-map-repository';
import { enrichLatestUpdateSummary } from '../runtime/diagnostics';
import {
  isJsonOutputRequested,
  printOutput,
  renderKeyValue,
  renderSection,
  renderTimestamp,
} from './admin-output';

async function main() {
  const config = createConfig();
  const db = createDb(config, { readonly: true });
  const taskCacheRepository = new TodoistTaskMapRepository(db);
  const eventCacheRepository = new CalendarEventMapRepository(db);
  const json = isJsonOutputRequested();
  const [tasks, events] = await Promise.all([
    taskCacheRepository.getCacheSummary(),
    eventCacheRepository.getCacheSummary(),
  ]);
  const payload = {
    timestamp: new Date().toISOString(),
    tasks: enrichLatestUpdateSummary(tasks, 60 * 30),
    events: enrichLatestUpdateSummary(events, 60 * 30),
  };
  const lines = [
    ...renderSection('Tasks', [
      renderKeyValue('Freshness', payload.tasks.freshness),
      renderKeyValue('Total', payload.tasks.totalCount),
      renderKeyValue('Active', payload.tasks.activeCount),
      renderKeyValue('Completed', payload.tasks.completedCount),
      renderKeyValue('Deleted', payload.tasks.deletedCount),
      renderTimestamp('Updated', payload.tasks.latestUpdatedAtUtc),
    ]),
    ...renderSection('Events', [
      renderKeyValue('Freshness', payload.events.freshness),
      renderKeyValue('Total', payload.events.totalCount),
      renderKeyValue('Active', payload.events.activeCount),
      renderKeyValue('Deleted', payload.events.deletedCount),
      renderKeyValue('Recurring', payload.events.recurringCount),
      renderTimestamp('Updated', payload.events.latestUpdatedAtUtc),
    ]),
  ];

  printOutput(payload, lines, json);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
