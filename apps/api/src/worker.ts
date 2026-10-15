// A separate worker process for background jobs (`npm run worker`). Run it when the API runs
// with JOBS_WORKER=false, e.g. to scale web and job processes independently.
import 'dotenv/config';
import { loadConfig } from './config';

try {
  loadConfig();
} catch (e) {
  console.error(`❌ ${(e as Error).message}`);
  process.exit(1);
}

const { logger } = await import('./lib/logger');
const { startWorkers } = await import('./jobs');
const { startOutboxFlusher } = await import('./lib/mailer');

const stop = await startWorkers();
const stopFlusher = startOutboxFlusher();
logger.info('Acadex worker running');

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    logger.info({ signal }, 'worker shutting down');
    stopFlusher();
    stop().then(
      () => process.exit(0),
      () => process.exit(1)
    );
    setTimeout(() => process.exit(1), 15_000).unref();
  });
}
