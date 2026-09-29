import { env } from './config/env.js';
import { createApp } from './app.js';
import { redis } from './lib/redis.js';
import { prisma } from './lib/prisma.js';
import { emailQueue } from './queue/queues.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;

const app = createApp();

const server = app.listen(env.PORT, () => {
  console.log(`API listening on http://localhost:${env.PORT}`);
});

let shuttingDown = false;

function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down API`);

  // Don't let a stuck request keep the process alive forever.
  setTimeout(() => {
    console.error('Shutdown timed out, forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS).unref();

  server.close(async () => {
    await Promise.allSettled([emailQueue.close(), redis.quit(), prisma.$disconnect()]);
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
