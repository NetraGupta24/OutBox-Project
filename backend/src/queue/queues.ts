import { Queue, type JobsOptions } from 'bullmq';
import { createRedisConnection } from '../lib/redis.js';

export const EMAIL_QUEUE = 'email';

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
  // Producer side (API): fail fast so scheduling returns 503 during a Redis outage.
  connection: createRedisConnection({ failFast: true }),
  defaultJobOptions: emailJobOptions,
});
