import { Worker, type Job } from 'bullmq';
import { createRedisConnection } from '../lib/redis.js';
import { errorMessage } from '../lib/errors.js';
import { NOTIFICATION_QUEUE, type NotificationJobData } from '../queue/queues.js';
import { env } from '../config/env.js';
import {
  limitReachedMessage,
  notifyUser,
  type SlackResult,
} from '../modules/slack/slack.service.js';

function windowName(ms: number): string {
  if (ms === 3_600_000) return 'hour';
  if (ms === 60_000) return 'minute';
  return `${Math.round(ms / 1000)} s`;
}

// Posts the alert to the user's Slack. Not connected: skipped, nothing fails.
async function processNotification(job: Job<NotificationJobData>): Promise<SlackResult> {
  const event = job.data;
  const message = limitReachedMessage({
    ...event,
    windowName: windowName(env.RATE_LIMIT_WINDOW_MS),
  });
  const result = await notifyUser(event.userId, message);
  const label = `[slack user ${event.userId}]`;
  if (result === 'sent') console.log(`${label} sent: ${message.text}`);
  else if (result === 'not_connected') console.log(`${label} not connected, alert skipped`);
  else console.warn(`${label} webhook no longer valid; marked disconnected`);
  return result;
}

export function createNotificationWorker(): Worker<NotificationJobData, SlackResult> {
  const worker = new Worker<NotificationJobData, SlackResult>(
    NOTIFICATION_QUEUE,
    processNotification,
    {
      connection: createRedisConnection({ label: 'notifications' }),
      concurrency: 5,
    },
  );
  worker.on('failed', (job, err) => {
    if (job) console.warn(`[notify] ${job.id} failed: ${errorMessage(err)}`);
  });
  worker.on('error', () => {}); // connection errors are logged by the connection
  return worker;
}
