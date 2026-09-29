import { env } from './config/env.js';
import { redis } from './lib/redis.js';

// Worker process entrypoint. The BullMQ email, notification and index
// workers are registered here in phases 4, 5 and 8.
async function main() {
  await redis.ping();
  console.log(`Worker process started (concurrency=${env.WORKER_CONCURRENCY})`);
}

async function shutdown(signal: string) {
  console.log(`${signal} received, shutting down worker`);
  await redis.quit();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

main().catch((err) => {
  console.error('Worker failed to start', err);
  process.exit(1);
});
