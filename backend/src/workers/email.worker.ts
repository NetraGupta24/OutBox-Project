import { DelayedError, UnrecoverableError, Worker, type Job } from 'bullmq';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { createRedisConnection } from '../lib/redis.js';
import { EMAIL_QUEUE, type EmailJobData } from '../queue/queues.js';
import {
  claimEmail,
  getDeliveryMarker,
  markFailed,
  markSent,
  releaseForRetry,
  setDeliveryMarker,
  type Delivery,
} from '../modules/emails/email.state.js';
import { deliver, errorMessage, isPermanentFailure } from '../modules/emails/mailer.js';

export type EmailJobResult =
  { outcome: 'sent'; messageId: string; resumed: boolean } | { outcome: 'skipped'; reason: string };

async function loadEmail(emailId: number) {
  return prisma.email.findUnique({
    where: { id: emailId },
    include: {
      campaign: { select: { bodyHtml: true, bodyText: true } },
      sender: true,
    },
  });
}

export async function processEmail(
  job: Job<EmailJobData>,
  token?: string,
): Promise<EmailJobResult> {
  const { emailId } = job.data;

  const email = await loadEmail(emailId);
  if (!email) return { outcome: 'skipped', reason: 'email no longer exists' };
  if (email.status === 'sent' || email.status === 'failed') {
    return { outcome: 'skipped', reason: `already ${email.status}` };
  }

  const claim = await claimEmail(emailId);
  if (claim.kind === 'done') return { outcome: 'skipped', reason: claim.reason };
  if (claim.kind === 'busy') {
    // Another attempt is mid-send; look again once its claim would be stale.
    // DelayedError tells BullMQ this is not a failure and uses no retry attempt.
    await job.moveToDelayed(claim.retryAt, token);
    throw new DelayedError();
  }

  // A previous attempt may have sent the email but failed to record it.
  let delivery: Delivery | null = await getDeliveryMarker(emailId);
  const resumed = delivery !== null;

  if (!delivery) {
    try {
      delivery = await deliver({
        id: email.id,
        campaignId: email.campaignId,
        recipient: email.recipient,
        subject: email.subject,
        bodyHtml: email.campaign.bodyHtml,
        bodyText: email.campaign.bodyText,
        sender: email.sender,
      });
    } catch (err) {
      const message = errorMessage(err);
      const permanent = isPermanentFailure(err);
      const lastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      if (permanent || lastAttempt) {
        await markFailed(emailId, message);
        if (permanent) throw new UnrecoverableError(message);
      } else {
        await releaseForRetry(emailId, message);
      }
      throw err;
    }
    // Best effort: without Redis the marker is lost, but the send already happened.
    await setDeliveryMarker(emailId, delivery).catch((err) =>
      console.error(`[email-${emailId}] could not store delivery marker:`, errorMessage(err)),
    );
  }

  // If this throws, BullMQ retries the job and the marker prevents a second send.
  await markSent(emailId, delivery);
  return { outcome: 'sent', messageId: delivery.messageId, resumed };
}

export function createEmailWorker(): Worker<EmailJobData, EmailJobResult> {
  const worker = new Worker<EmailJobData, EmailJobResult>(EMAIL_QUEUE, processEmail, {
    // Workers need a connection that waits out Redis outages (maxRetriesPerRequest: null).
    connection: createRedisConnection({ label: 'worker' }),
    concurrency: env.WORKER_CONCURRENCY,
  });

  // The worker re-emits the same connection error on every retry: log each distinct one once.
  let lastError = '';
  worker.on('error', (err) => {
    if (err.message === lastError) return;
    lastError = err.message;
    console.error('Email worker error:', errorMessage(err));
  });

  worker.on('completed', (job, result) => {
    lastError = '';
    const label = `[email-${job.data.emailId}]`;
    if (result.outcome === 'sent') {
      console.log(`${label} sent${result.resumed ? ' (recorded from earlier attempt)' : ''}`);
    } else {
      console.log(`${label} skipped: ${result.reason}`);
    }
  });
  worker.on('failed', (job, err) => {
    if (!job) return;
    const final = job.attemptsMade >= (job.opts.attempts ?? 1) || err instanceof UnrecoverableError;
    console.warn(
      `[email-${job.data.emailId}] attempt ${job.attemptsMade} failed${final ? ' (final)' : ''}: ${errorMessage(err)}`,
    );
  });

  return worker;
}
