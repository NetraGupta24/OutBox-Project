import { Queue, type JobsOptions } from 'bullmq';
import { createRedisConnection } from '../lib/redis.js';

export const EMAIL_QUEUE = 'email';
export const NOTIFICATION_QUEUE = 'notification';
export const SEARCH_INDEX_QUEUE = 'search-index';
const ENQUEUE_CHUNK_SIZE = 500;

export type EmailJobData = {
  emailId: number;
  // Set by the rate limiter; each is valid only for the attempt that made it.
  reservation?: { sendAt: number; attempt: number }; // send slot already counted
  deferral?: { window: number; attempt: number }; // window this email was moved into
};

// One job per email row. The jobId is derived from the row id, so adding the
// same email twice is a no-op in BullMQ.
export function emailJobId(emailId: number): string {
  return `email-${emailId}`;
}

export const emailJobOptions: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { age: 24 * 3600 },
  removeOnFail: false,
};

// Producer connection shared by both queues. Fails fast so API requests return
// 503 during a Redis outage instead of hanging.
const producerConnection = createRedisConnection({ label: 'queue', failFast: true });

export const emailQueue = new Queue<EmailJobData>(EMAIL_QUEUE, {
  connection: producerConnection,
  defaultJobOptions: emailJobOptions,
});

export type RateLimitReachedEvent = {
  type: 'rate-limit-reached';
  scope: 'sender' | 'campaign';
  userId: number;
  senderId: number;
  senderEmail: string;
  campaignId: number;
  campaignSubject: string;
  limit: number;
  windowStart: string; // ISO
  windowEnd: string; // ISO: sending resumes from here
};

export type NotificationJobData = RateLimitReachedEvent;

export const notificationQueue = new Queue<NotificationJobData>(NOTIFICATION_QUEUE, {
  connection: producerConnection,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 2_000 },
    removeOnComplete: { age: 7 * 24 * 3600 },
    removeOnFail: { age: 7 * 24 * 3600 },
  },
});

export type SearchIndexJobData = { emailIds: number[] };

// Keeps Elasticsearch in step with MySQL. Retries for a while if Elasticsearch
// is down; sending never waits on it.
export const searchIndexQueue = new Queue<SearchIndexJobData>(SEARCH_INDEX_QUEUE, {
  connection: producerConnection,
  defaultJobOptions: {
    attempts: 10,
    backoff: { type: 'exponential', delay: 2_000 },
    removeOnComplete: { count: 1000 },
    removeOnFail: { age: 7 * 24 * 3600 },
  },
});

export async function queueSearchIndex(emailIds: number[]): Promise<void> {
  for (let i = 0; i < emailIds.length; i += ENQUEUE_CHUNK_SIZE) {
    await searchIndexQueue.add('index', { emailIds: emailIds.slice(i, i + ENQUEUE_CHUNK_SIZE) });
  }
}

// Connection errors are already logged by the connection itself.
emailQueue.on('error', () => {});
notificationQueue.on('error', () => {});
searchIndexQueue.on('error', () => {});

export type EmailToQueue = { id: number; scheduledAt: Date };

// Adds a delayed job per email, due at its scheduledAt (immediately if overdue).
export async function enqueueEmails(emails: EmailToQueue[]): Promise<void> {
  const now = Date.now();
  for (let i = 0; i < emails.length; i += ENQUEUE_CHUNK_SIZE) {
    const chunk = emails.slice(i, i + ENQUEUE_CHUNK_SIZE);
    await emailQueue.addBulk(
      chunk.map((email) => ({
        name: 'send',
        data: { emailId: email.id },
        opts: {
          jobId: emailJobId(email.id),
          delay: Math.max(0, email.scheduledAt.getTime() - now),
        },
      })),
    );
  }
}
