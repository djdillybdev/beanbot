import { createConfig } from '../config';
import { createDb } from '../db/client';
import { CalendarEventMapRepository } from '../db/calendar-event-map-repository';
import { TodoistTaskMapRepository } from '../db/todoist-task-map-repository';

async function main() {
  const config = createConfig();
  const db = createDb(config);
  const taskCacheRepository = new TodoistTaskMapRepository(db);
  const eventCacheRepository = new CalendarEventMapRepository(db);
  const [tasks, events] = await Promise.all([
    taskCacheRepository.getCacheSummary(),
    eventCacheRepository.getCacheSummary(),
  ]);

  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    tasks,
    events,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
