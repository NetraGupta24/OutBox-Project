/**
 * Status transitions for one email row, used by the worker:
 *
 *   scheduled ──rate limit──▶ delayed (moved to the next window)
 *   scheduled | delayed ──claim──▶ sending ──▶ sent
 *                                     │
 *                                     ├──▶ scheduled (temporary error, BullMQ retries)
 *                                     └──▶ failed    (permanent error or last attempt)
 *
 * The claim is a single conditional UPDATE, so only one worker can move a row
 * into `sending`, however many copies of its job run.
 */
import { prisma } from '../../lib/prisma.js';
import { redis } from '../../lib/redis.js';

// A row still `sending` after this long is assumed to belong to a worker that
// crashed mid-send, and may be claimed again. SMTP timeouts keep a live send
// well below it.
export const SEND_LOCK_STALE_MS = 2 * 60_000;

const DELIVERY_MARKER_TTL_SECONDS = 7 * 24 * 3600;

export type Delivery = {
  messageId: string;
  previewUrl: string | null;
  sentAt: string; // ISO
};

export type ClaimResult =
  { kind: 'claimed' } | { kind: 'busy'; retryAt: number } | { kind: 'done'; reason: string };

export async function claimEmail(emailId: number, now = new Date()): Promise<ClaimResult> {
  const staleBefore = new Date(now.getTime() - SEND_LOCK_STALE_MS);
  const { count } = await prisma.email.updateMany({
    where: {
      id: emailId,
      OR: [
        { status: { in: ['scheduled', 'delayed'] } },
        { status: 'sending', lockedAt: { lt: staleBefore } },
      ],
    },
    data: { status: 'sending', lockedAt: now, attempts: { increment: 1 } },
  });
  if (count === 1) return { kind: 'claimed' };

  const row = await prisma.email.findUnique({
    where: { id: emailId },
    select: { status: true, lockedAt: true },
  });
  if (!row) return { kind: 'done', reason: 'email no longer exists' };
  if (row.status === 'sent' || row.status === 'failed') {
    return { kind: 'done', reason: `already ${row.status}` };
  }
  // Another attempt holds a fresh claim: check again once it would be stale.
  const lockedAt = row.lockedAt?.getTime() ?? now.getTime();
  return { kind: 'busy', retryAt: Math.max(lockedAt + SEND_LOCK_STALE_MS + 1_000, now.getTime()) };
}

export async function markSent(emailId: number, delivery: Delivery): Promise<void> {
  await prisma.email.updateMany({
    where: { id: emailId, status: 'sending' },
    data: {
      status: 'sent',
      sentAt: new Date(delivery.sentAt),
      messageId: delivery.messageId,
      previewUrl: delivery.previewUrl,
      lockedAt: null,
      error: null,
    },
  });
}

// The rate limiter moved the email to a later time. The new time is saved so
// the Scheduled list shows when it will really go out. `delayed` is only used
// when a limit was hit, not for a short wait behind emails queued earlier.
export async function deferEmail(
  emailId: number,
  retryAt: number,
  { limitHit }: { limitHit: boolean },
): Promise<void> {
  await prisma.email.updateMany({
    where: { id: emailId, status: { in: ['scheduled', 'delayed'] } },
    data: { scheduledAt: new Date(retryAt), ...(limitHit ? { status: 'delayed' } : {}) },
  });
}

// Temporary failure: hand the row back so the next BullMQ attempt can claim it.
export async function releaseForRetry(emailId: number, error: string): Promise<void> {
  await prisma.email.updateMany({
    where: { id: emailId, status: 'sending' },
    data: { status: 'scheduled', lockedAt: null, error },
  });
}

export async function markFailed(emailId: number, error: string): Promise<void> {
  await prisma.email.updateMany({
    where: { id: emailId, status: 'sending' },
    data: { status: 'failed', lockedAt: null, error },
  });
}

/*
 * Delivery marker: written to Redis right after SMTP accepts a message. If
 * saving `sent` to MySQL then fails, the retry finds the marker and only
 * records the result instead of sending the email a second time.
 */
const markerKey = (emailId: number) => `email:delivered:${emailId}`;

export async function getDeliveryMarker(emailId: number): Promise<Delivery | null> {
  const raw = await redis.get(markerKey(emailId));
  return raw ? (JSON.parse(raw) as Delivery) : null;
}

export async function setDeliveryMarker(emailId: number, delivery: Delivery): Promise<void> {
  await redis.set(markerKey(emailId), JSON.stringify(delivery), 'EX', DELIVERY_MARKER_TTL_SECONDS);
}
