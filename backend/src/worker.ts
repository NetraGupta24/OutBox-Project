import { env } from './config/env.js';
import { prisma } from './lib/prisma.js';
import { redis } from './lib/redis.js';
import { emailQueue, notificationQueue } from './queue/queues.js';
import { reconcileEmailJobs } from './queue/reconcile.js';
import { closeTransports } from './modules/senders/transportPool.js';
import { createEmailWorker } from './workers/email.worker.js';
import { createNotificationWorker } from './workers/notification.worker.js';

const SHUTDOWN_TIMEOUT_MS = 30_000;

const worker = createEmailWorker();
const notificationWorker = createNotificationWorker();
const windowLabel =
  env.RATE_LIMIT_WINDOW_MS === 3_600_000 ? 'hour' : `${env.RATE_LIMIT_WINDOW_MS / 1000}s window`;
console.log(
  `Email worker started: concurrency ${env.WORKER_CONCURRENCY}, ` +
    `max ${env.MAX_EMAILS_PER_HOUR_PER_SENDER} per sender per ${windowLabel}, ` +
    `min ${env.MIN_SEND_INTERVAL_MS} ms between sends` +
    (env.SMTP_DRY_RUN ? ', SMTP dry run' : ''),
);

// Reconcile on startup and after every Redis reconnect. Runs are serialised;
// a trigger during a run schedules one more run.
let reconciling = false;
let rerun = false;

async function reconcile(trigger: string) {
  if (reconciling) {
    rerun = true;
    return;
  }
  reconciling = true;
  try {
    do {
      rerun = false;
      const { checked, requeued } = await reconcileEmailJobs();
      console.log(`Reconcile (${trigger}): ${checked} pending email(s), ${requeued} re-queued`);
    } while (rerun);
  } catch (err) {
    console.error(`Reconcile (${trigger}) failed:`, (err as Error).message);
  } finally {
    reconciling = false;
  }
}

let readyBefore = false;
redis.on('ready', () => {
  void reconcile(readyBefore ? 'redis reconnected' : 'startup');
  readyBefore = true;
});

let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received: finishing active jobs, then exiting`);

  setTimeout(() => {
    console.error('Shutdown timed out, forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS).unref();

  // Stops taking new jobs and waits for the ones in progress.
  await Promise.allSettled([worker.close(), notificationWorker.close()]);
  closeTransports();
  await Promise.allSettled([
    emailQueue.close(),
    notificationQueue.close(),
    prisma.$disconnect(),
    redis.quit(),
  ]);
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
