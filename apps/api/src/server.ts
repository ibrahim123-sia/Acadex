import 'dotenv/config';
import { loadConfig, type Config } from './config';

let config: Config;
try {
  config = loadConfig();
} catch (e) {
  console.error(`❌ ${(e as Error).message}`);
  process.exit(1);
}

const { initSentry } = await import('./lib/sentry');
initSentry(config.sentryDsn, config.env);

const { createApp } = await import('./app');
const { logger } = await import('./lib/logger');
const { startOutboxFlusher } = await import('./lib/mailer');
startOutboxFlusher();
const { startWorkers } = await import('./jobs');
const stopWorkers = config.jobsWorker ? await startWorkers().catch((err) => {
  logger.error({ err }, 'job workers did not start');
  return async () => {};
}) : async () => {};

const server = createApp(config).listen(config.port, () => logger.info(`Acadex API listening on port ${config.port}`));

// Finish in-flight requests on redeploys instead of dropping them.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    logger.info({ signal }, 'shutting down');
    server.close(() => void stopWorkers().finally(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
