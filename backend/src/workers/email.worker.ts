import { DelayedError, UnrecoverableError, Worker, type Job } from 'bullmq';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { createRedisConnection } from '../lib/redis.js';
import { EMAIL_QUEUE, queueSearchIndex, type EmailJobData } from '../queue/queues.js';
import {
  claimEmail,
  deferEmail,
  getDeliveryMarker,
  isFinished,
  markFailed,
  markSent,
  releaseForRetry,
  setDeliveryMarker,
  type Delivery,
} from '../modules/emails/email.state.js';
import { deliver, isPermanentFailure } from '../modules/emails/mailer.js';
import { errorMessage } from '../lib/errors.js';
import { releaseDeferral, reserveSendSlot } from '../modules/rateLimit/rateLimiter.js';
import { reportLimitReached } from '../modules/rateLimit/limitEvents.js';
import { senderHourlyLimit } from '../modules/senders/sender.service.js';

export type EmailJobResult =
  { outcome: 'sent'; messageId: string; resumed: boolean } | { outcome: 'skipped'; reason: string };

async function loadEmail(emailId: number) {
  return prisma.email.findUnique({
    where: { id: emailId },
    include: {
      campaign: { select: { bodyHtml: true, bodyText: true, subject: true, hourlyLimit: true } },
      sender: true,
    },
  });
}

// Keeps the search index in step after a status change. Best effort: the
// index-rebuild script covers anything missed.
function reindex(emailId: number) {
  void queueSearchIndex([emailId]).catch((err) =>
    console.error(`[email-${emailId}] could not queue search indexing:`, errorMessage(err)),
  );
}

export async function processEmail(
  job: Job<EmailJobData>,
  token?: string,
): Promise<EmailJobResult> {
  const { emailId } = job.data;

  const email = await loadEmail(emailId);
  if (!email) return { outcome: 'skipped', reason: 'email no longer exists' };
  if (isFinished(email.status)) {
    // A cancelled email may have been deferred into a later window: hand its
    // place there back, so it doesn't hold up the emails behind it.
    if (email.status === 'cancelled' && job.data.deferral?.attempt === job.attemptsMade) {
      await releaseDeferral({
        senderId: email.senderId,
        campaignId: email.campaignId,
        window: job.data.deferral.window,
        windowMs: env.RATE_LIMIT_WINDOW_MS,
      });
    }
    return { outcome: 'skipped', reason: `already ${email.status}` };
  }

  // Rate limit: reserve a send slot before claiming. A reservation or deferral
  // stored on the job is only valid for the attempt that made it.
  const now = Date.now();
  const { reservation, deferral } = job.data;
  const hasSlot = reservation?.attempt === job.attemptsMade && reservation.sendAt <= now;

  if (!hasSlot) {
    const senderLimit = senderHourlyLimit(email.sender);
    const campaignLimit = email.campaign.hourlyLimit;
    const deferredFrom =
      deferral?.attempt === job.attemptsMade ? { window: deferral.window } : undefined;
    const result = await reserveSendSlot({
      now,
      senderId: email.senderId,
      campaignId: email.campaignId,
      senderLimit,
      campaignLimit,
      minIntervalMs: env.MIN_SEND_INTERVAL_MS,
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      deferredFrom,
    });

    const limitHit =
      result.kind === 'deferred'
        ? result.scope === 'queue'
          ? null
          : result.scope
        : result.reachedSenderLimit
          ? 'sender'
          : result.reachedCampaignLimit
            ? 'campaign'
            : null;
    if (limitHit) {
      const windowMs = env.RATE_LIMIT_WINDOW_MS;
      await reportLimitReached(
        {
          scope: limitHit,
          userId: email.userId,
          senderId: email.senderId,
          senderEmail: email.sender.email,
          campaignId: email.campaignId,
          campaignSubject: email.campaign.subject,
          limit: limitHit === 'sender' ? senderLimit : campaignLimit,
          windowStart: new Date(result.window * windowMs).toISOString(),
          windowEnd: new Date((result.window + 1) * windowMs).toISOString(),
        },
        result.window,
      ).catch((err) =>
        console.error(`[email-${emailId}] could not queue limit notification:`, errorMessage(err)),
      );
    }

    if (result.kind === 'deferred') {
      // Moved to a later window (or behind emails already waiting in this one),
      // keeping arrival order. Not a failure, so no retry attempt is used.
      await deferEmail(emailId, result.retryAt, { limitHit: result.scope !== 'queue' });
      reindex(emailId);
      await job.updateData({
        emailId,
        deferral: { window: result.targetWindow, attempt: job.attemptsMade },
      });
      await job.moveToDelayed(result.retryAt, token);
      throw new DelayedError();
    }
    if (result.sendAt > now) {
      // Too soon after this sender's previous email: wait for the reserved slot.
      await job.updateData({
        emailId,
        reservation: { sendAt: result.sendAt, attempt: job.attemptsMade },
      });
      await job.moveToDelayed(result.sendAt, token);
      throw new DelayedError();
    }
    if (deferredFrom) {
      // The deferral has been used: a later re-run must not count it again.
      await job.updateData({ emailId });
    }
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
        reindex(emailId);
        if (permanent) throw new UnrecoverableError(message);
      } else {
        await releaseForRetry(emailId, message);
        reindex(emailId);
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
  reindex(emailId);
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
