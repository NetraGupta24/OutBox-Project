/**
 * User actions on emails that haven't gone out, or that failed:
 *
 *   cancel  scheduled | delayed ──▶ cancelled   (the job is removed)
 *   retry   failed ──▶ scheduled                (a fresh job, due now)
 *
 * MySQL decides: the row is updated with a conditional UPDATE, so an email the
 * worker has already claimed (`sending`) can't be cancelled, and a job that
 * couldn't be removed (it was running) is skipped by the worker when it sees
 * the cancelled row.
 */
import type { EmailStatus, Prisma } from '../../generated/prisma/client.js';
import { env } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import { HttpError, notFound } from '../../lib/httpError.js';
import { withTimeout } from '../../lib/async.js';
import { errorMessage } from '../../lib/errors.js';
import { emailJobId, emailQueue, enqueueEmails, queueSearchIndex } from '../../queue/queues.js';
import { releaseDeferral } from '../rateLimit/rateLimiter.js';

const CANCELLABLE: EmailStatus[] = ['scheduled', 'delayed'];
const QUEUE_TIMEOUT_MS = 5_000;
const CHUNK = 100;

export type Target = { userId: number; campaignId?: number; emailId?: number };

function targetWhere({ userId, campaignId, emailId }: Target): Prisma.EmailWhereInput {
  return {
    userId,
    ...(campaignId !== undefined ? { campaignId } : {}),
    ...(emailId !== undefined ? { id: emailId } : {}),
  };
}

// 404 unless the campaign or email exists and belongs to the user.
async function assertExists(target: Target): Promise<void> {
  if (target.campaignId !== undefined) {
    const found = await prisma.campaign.count({
      where: { id: target.campaignId, userId: target.userId },
    });
    if (!found) throw notFound('Campaign not found');
  }
  if (target.emailId !== undefined) {
    const found = await prisma.email.count({ where: targetWhere(target) });
    if (!found) throw notFound('Email not found');
  }
}

function reindex(ids: number[]) {
  void queueSearchIndex(ids).catch((err) =>
    console.error('Could not queue search indexing:', errorMessage(err)),
  );
}

async function inChunks<T>(items: T[], fn: (item: T) => Promise<unknown>) {
  for (let i = 0; i < items.length; i += CHUNK) {
    await Promise.allSettled(items.slice(i, i + CHUNK).map(fn));
  }
}

// Removes a cancelled email's job. If it was waiting in a later window, its
// place there is handed back. A running job can't be removed; the worker
// skips it (and hands the place back) when it sees the cancelled row.
async function dropJob(row: { id: number; senderId: number; campaignId: number }) {
  const job = await emailQueue.getJob(emailJobId(row.id));
  if (!job) return;
  const { deferral } = job.data;
  const attempt = job.attemptsMade;
  try {
    await job.remove();
  } catch {
    return; // running right now
  }
  if (deferral && deferral.attempt === attempt) {
    await releaseDeferral({
      senderId: row.senderId,
      campaignId: row.campaignId,
      window: deferral.window,
      windowMs: env.RATE_LIMIT_WINDOW_MS,
    });
  }
}

export async function cancelEmails(target: Target): Promise<{ cancelled: number }> {
  await assertExists(target);
  const candidates = await prisma.email.findMany({
    where: { ...targetWhere(target), status: { in: CANCELLABLE } },
    select: { id: true },
  });
  if (candidates.length === 0) return { cancelled: 0 };

  const ids = candidates.map((row) => row.id);
  const { count } = await prisma.email.updateMany({
    where: { id: { in: ids }, status: { in: CANCELLABLE } },
    data: { status: 'cancelled', lockedAt: null },
  });

  // Only the rows this request actually cancelled (not ones claimed meanwhile).
  const cancelled = await prisma.email.findMany({
    where: { id: { in: ids }, status: 'cancelled' },
    select: { id: true, senderId: true, campaignId: true },
  });
  // Best effort: a job left behind finds the row cancelled and does nothing.
  await inChunks(cancelled, (row) =>
    withTimeout(dropJob(row), QUEUE_TIMEOUT_MS, 'Queue unavailable'),
  );
  reindex(cancelled.map((row) => row.id));
  return { cancelled: count };
}

export async function retryEmails(target: Target): Promise<{ retried: number }> {
  await assertExists(target);
  const failed = await prisma.email.findMany({
    where: { ...targetWhere(target), status: 'failed' },
    select: { id: true },
  });
  if (failed.length === 0) return { retried: 0 };
  const ids = failed.map((row) => row.id);

  // The old job has the same id, so it must go before a new one can be added.
  // Done first: if the queue is down, nothing has changed yet.
  try {
    await withTimeout(
      (async () => {
        for (let i = 0; i < ids.length; i += CHUNK) {
          await Promise.all(ids.slice(i, i + CHUNK).map((id) => emailQueue.remove(emailJobId(id))));
        }
      })(),
      QUEUE_TIMEOUT_MS,
      'Queue unavailable',
    );
  } catch (err) {
    console.error('Retry: could not clear old jobs:', errorMessage(err));
    throw new HttpError(503, 'The queue is unavailable. Try again shortly.');
  }

  const now = new Date();
  const { count } = await prisma.email.updateMany({
    where: { id: { in: ids }, status: 'failed' },
    data: { status: 'scheduled', scheduledAt: now, attempts: 0, error: null, lockedAt: null },
  });
  const retried = await prisma.email.findMany({
    where: { id: { in: ids }, status: 'scheduled' },
    select: { id: true, scheduledAt: true },
    orderBy: { id: 'asc' },
  });

  try {
    await withTimeout(enqueueEmails(retried), QUEUE_TIMEOUT_MS, 'Queue unavailable');
  } catch (err) {
    // The rows are saved as scheduled; the worker re-queues them when it
    // (re)connects to Redis.
    console.error('Retry: could not queue emails:', errorMessage(err));
    throw new HttpError(503, 'Saved, but the queue is unavailable. Sending resumes shortly.');
  }
  reindex(retried.map((row) => row.id));
  return { retried: count };
}
