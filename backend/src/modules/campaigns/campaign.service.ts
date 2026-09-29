import { Prisma } from '../../generated/prisma/client.js';
import { env } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import { HttpError, badRequest } from '../../lib/httpError.js';
import { withTimeout } from '../../lib/async.js';
import { emailJobId, emailQueue } from '../../queue/queues.js';
import { getUsableSender, senderHourlyLimit } from '../senders/sender.service.js';
import { planSchedule } from './schedulePlanner.js';
import { htmlToText, normalizeRecipients } from './recipients.js';
import type { CampaignInput } from './campaign.schema.js';

const ENQUEUE_CHUNK_SIZE = 500;
// BullMQ waits for Redis to be ready before running commands, so an outage
// would otherwise hang the request.
const ENQUEUE_TIMEOUT_MS = 5_000;
// 10,000 rows take ~3 s locally; Prisma's 5 s default is too tight for slower machines.
const CREATE_TX_TIMEOUT_MS = 30_000;

type ScheduleSettings = {
  senderId: number;
  startAt?: string;
  delayMs: number;
  hourlyLimit: number;
};

export type CampaignSummary = {
  id: number;
  senderId: number;
  subject: string;
  total: number;
  startAt: string;
  projectedFinishAt: string | null;
  delayMs: number;
  hourlyLimit: number;
  createdAt: string;
};

export type CreateCampaignResult = {
  campaign: CampaignSummary;
  duplicatesRemoved: number;
  replayed: boolean;
};

// The settings actually applied: the system minimum gap and the sender's cap
// can only make scheduling more conservative than what the user asked for.
async function resolveSettings(userId: number, input: ScheduleSettings, now: number) {
  const sender = await getUsableSender(userId, input.senderId);
  const requestedStart = input.startAt ? Date.parse(input.startAt) : now;
  return {
    sender,
    startAt: Math.max(requestedStart, now),
    delayMs: Math.max(input.delayMs, env.MIN_SEND_INTERVAL_MS),
    hourlyLimit: Math.min(input.hourlyLimit, senderHourlyLimit(sender)),
  };
}

export async function previewCampaign(userId: number, input: ScheduleSettings & { count: number }) {
  const settings = await resolveSettings(userId, input, Date.now());
  const plan = planSchedule({ count: input.count, ...settings });
  return {
    count: input.count,
    startAt: new Date(settings.startAt).toISOString(),
    finishAt: plan.finishAt === null ? null : new Date(plan.finishAt).toISOString(),
    hourWindows: plan.windowsUsed,
    effectiveDelayMs: settings.delayMs,
    effectiveHourlyLimit: settings.hourlyLimit,
  };
}

/**
 * Adds a delayed job for every email of the campaign that still needs sending.
 * Safe to call repeatedly: jobIds are deterministic, so existing jobs are
 * left untouched, and already-sent emails are skipped.
 */
export async function enqueueCampaign(campaignId: number): Promise<number> {
  const pending = await prisma.email.findMany({
    where: { campaignId, status: { in: ['scheduled', 'delayed'] } },
    select: { id: true, scheduledAt: true },
    orderBy: { id: 'asc' },
  });

  const now = Date.now();
  for (let i = 0; i < pending.length; i += ENQUEUE_CHUNK_SIZE) {
    const chunk = pending.slice(i, i + ENQUEUE_CHUNK_SIZE);
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
  return pending.length;
}

async function summarize(campaignId: number): Promise<CampaignSummary> {
  const campaign = await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } });
  const last = await prisma.email.findFirst({
    where: { campaignId },
    orderBy: { scheduledAt: 'desc' },
    select: { scheduledAt: true },
  });
  return {
    id: campaign.id,
    senderId: campaign.senderId,
    subject: campaign.subject,
    total: campaign.total,
    startAt: campaign.startAt.toISOString(),
    projectedFinishAt: last?.scheduledAt.toISOString() ?? null,
    delayMs: campaign.delayMs,
    hourlyLimit: campaign.hourlyLimit,
    createdAt: campaign.createdAt.toISOString(),
  };
}

async function replay(
  userId: number,
  idempotencyKey: string,
): Promise<CreateCampaignResult | null> {
  const existing = await prisma.campaign.findUnique({
    where: { userId_idempotencyKey: { userId, idempotencyKey } },
    select: { id: true },
  });
  if (!existing) return null;
  // Re-enqueue in case the original request failed after the DB commit.
  await withTimeout(enqueueCampaign(existing.id), ENQUEUE_TIMEOUT_MS, 'Queue unavailable').catch(
    (err) => {
      console.error(`Campaign ${existing.id} replay could not be queued:`, (err as Error).message);
      throw new HttpError(503, 'Campaign exists but could not be queued. Retry shortly.', {
        campaignId: existing.id,
      });
    },
  );
  return { campaign: await summarize(existing.id), duplicatesRemoved: 0, replayed: true };
}

export async function createCampaign(
  userId: number,
  input: CampaignInput,
  idempotencyKey?: string,
): Promise<CreateCampaignResult> {
  if (idempotencyKey) {
    const replayed = await replay(userId, idempotencyKey);
    if (replayed) return replayed;
  }

  const { valid, invalid, duplicatesRemoved } = normalizeRecipients(input.recipients);
  if (invalid.length > 0) {
    throw badRequest(`${invalid.length} invalid email address(es)`, {
      invalid: invalid.slice(0, 20),
    });
  }
  if (valid.length === 0) throw badRequest('No recipients');

  const settings = await resolveSettings(userId, input, Date.now());
  const plan = planSchedule({ count: valid.length, ...settings });

  let campaignId: number;
  try {
    campaignId = await prisma.$transaction(
      async (tx) => {
        const campaign = await tx.campaign.create({
          data: {
            userId,
            senderId: settings.sender.id,
            subject: input.subject,
            bodyHtml: input.bodyHtml,
            bodyText: input.bodyText ?? htmlToText(input.bodyHtml),
            startAt: new Date(settings.startAt),
            delayMs: settings.delayMs,
            hourlyLimit: settings.hourlyLimit,
            total: valid.length,
            idempotencyKey: idempotencyKey ?? null,
          },
        });
        await tx.email.createMany({
          data: valid.map((recipient, i) => ({
            campaignId: campaign.id,
            userId,
            senderId: settings.sender.id,
            recipient,
            subject: input.subject,
            scheduledAt: new Date(plan.times[i]!),
          })),
        });
        return campaign.id;
      },
      { timeout: CREATE_TX_TIMEOUT_MS, maxWait: 10_000 },
    );
  } catch (err) {
    // Two concurrent requests with the same key: the loser returns the winner's campaign.
    if (
      idempotencyKey &&
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      const replayed = await replay(userId, idempotencyKey);
      if (replayed) return replayed;
    }
    throw err;
  }

  try {
    await withTimeout(enqueueCampaign(campaignId), ENQUEUE_TIMEOUT_MS, 'Queue unavailable');
  } catch (err) {
    console.error(`Campaign ${campaignId} saved but enqueueing failed:`, (err as Error).message);
    throw new HttpError(
      503,
      'Campaign saved but could not be queued. Retry with the same Idempotency-Key.',
      { campaignId },
    );
  }

  return { campaign: await summarize(campaignId), duplicatesRemoved, replayed: false };
}
