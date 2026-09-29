import { Worker, type Job } from 'bullmq';
import { createRedisConnection } from '../lib/redis.js';
import { errorMessage } from '../modules/emails/mailer.js';
import { NOTIFICATION_QUEUE, type NotificationJobData } from '../queue/queues.js';

function describe(event: NotificationJobData): string {
  const what =
    event.scope === 'sender'
      ? `Sender ${event.senderEmail} reached its limit of ${event.limit} emails per window`
      : `Campaign "${event.campaignSubject}" reached its limit of ${event.limit} emails per window on ${event.senderEmail}`;
  return `${what}. Remaining emails are queued and resume at ${event.windowEnd}.`;
}

// Phase 8 delivers these to the user's Slack; until then they are logged.
async function processNotification(job: Job<NotificationJobData>): Promise<void> {
  console.log(`[notify user ${job.data.userId}] ${describe(job.data)}`);
}

export function createNotificationWorker(): Worker<NotificationJobData> {
  const worker = new Worker<NotificationJobData>(NOTIFICATION_QUEUE, processNotification, {
    connection: createRedisConnection({ label: 'notifications' }),
    concurrency: 5,
  });
  worker.on('failed', (job, err) => {
    if (job) console.warn(`[notify] ${job.id} failed: ${errorMessage(err)}`);
  });
  worker.on('error', () => {}); // connection errors are logged by the connection
  return worker;
}
