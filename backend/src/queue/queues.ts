import { Queue, type JobsOptions } from 'bullmq';
import { createRedisConnection } from '../lib/redis.js';

export const EMAIL_QUEUE = 'email';
const ENQUEUE_CHUNK_SIZE = 500;

export type EmailJobData = {
  emailId: number;
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

export const emailQueue = new Queue<EmailJobData>(EMAIL_QUEUE, {
  // Fail fast so API requests return 503 during a Redis outage instead of hanging.
  connection: createRedisConnection({ label: 'queue', failFast: true }),
  defaultJobOptions: emailJobOptions,
});
// Connection errors are already logged by the connection itself.
emailQueue.on('error', () => {});

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
