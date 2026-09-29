import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { redis } from '../../lib/redis.js';
import { emailJobId, emailQueue, notificationQueue } from '../../queue/queues.js';
import { reconcileEmailJobs } from '../../queue/reconcile.js';
import { claimEmail } from '../emails/email.state.js';
import { createCampaign } from './campaign.service.js';
import type { CampaignInput } from './campaign.schema.js';
import { createUserAndSender, resetDatabase } from '../../../test/helpers.js';

let userId: number;
let senderId: number;

function input(recipients: string[]): CampaignInput {
  return {
    senderId,
    subject: 'Integration test',
    bodyHtml: '<p>Hello</p>',
    recipients,
    startAt: new Date(Date.now() + 24 * 3_600_000).toISOString(),
    delayMs: 2000,
    hourlyLimit: 100,
  };
}

beforeEach(async () => {
  await resetDatabase();
  ({
    user: { id: userId },
    sender: { id: senderId },
  } = await createUserAndSender());
});

afterAll(async () => {
  await Promise.allSettled([emailQueue.close(), notificationQueue.close()]);
  await Promise.allSettled([prisma.$disconnect(), redis.quit()]);
});

describe('createCampaign', () => {
  it('saves one row and one delayed job per unique recipient', async () => {
    const result = await createCampaign(userId, input(['a@x.com', 'b@x.com', 'A@x.com']));

    expect(result.duplicatesRemoved).toBe(1);
    const emails = await prisma.email.findMany({ where: { campaignId: result.campaign.id } });
    expect(emails.map((e) => e.recipient).sort()).toEqual(['a@x.com', 'b@x.com']);
    const states = await Promise.all(emails.map((e) => emailQueue.getJobState(emailJobId(e.id))));
    expect(states).toEqual(['delayed', 'delayed']);
  });

  it('returns the original campaign when the Idempotency-Key is repeated', async () => {
    const first = await createCampaign(userId, input(['a@x.com']), 'repeat-key-0001');
    const second = await createCampaign(userId, input(['a@x.com']), 'repeat-key-0001');

    expect(first.replayed).toBe(false);
    expect(second).toMatchObject({ replayed: true, campaign: { id: first.campaign.id } });
    expect(await prisma.campaign.count()).toBe(1);
  });

  it('creates exactly one campaign for 5 simultaneous requests with the same key', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => createCampaign(userId, input(['a@x.com']), 'race-key-0001')),
    );

    expect(await prisma.campaign.count()).toBe(1);
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect(new Set(results.map((r) => r.campaign.id)).size).toBe(1);
  });
});

describe('claimEmail', () => {
  it('lets exactly one of 20 simultaneous claims win', async () => {
    const { campaign } = await createCampaign(userId, input(['a@x.com']));
    const email = await prisma.email.findFirstOrThrow({ where: { campaignId: campaign.id } });

    const results = await Promise.all(Array.from({ length: 20 }, () => claimEmail(email.id)));

    expect(results.filter((r) => r.kind === 'claimed')).toHaveLength(1);
    expect(results.filter((r) => r.kind === 'busy')).toHaveLength(19);
  });
});

describe('reconcileEmailJobs', () => {
  it('re-queues unsent emails that lost their job, and nothing else', async () => {
    const { campaign } = await createCampaign(userId, input(['a@x.com', 'b@x.com', 'c@x.com']));
    const [lost, sent, intact] = await prisma.email.findMany({
      where: { campaignId: campaign.id },
      orderBy: { id: 'asc' },
    });

    // "lost" simulates Redis losing its job; "sent" finished and its job was cleaned up.
    await emailQueue.remove(emailJobId(lost!.id));
    await emailQueue.remove(emailJobId(sent!.id));
    await prisma.email.update({ where: { id: sent!.id }, data: { status: 'sent' } });

    const report = await reconcileEmailJobs();

    expect(report).toEqual({ checked: 2, requeued: 1 });
    expect(await emailQueue.getJobState(emailJobId(lost!.id))).toBe('delayed');
    expect(await emailQueue.getJobState(emailJobId(sent!.id))).toBe('unknown');
    expect(await emailQueue.getJobState(emailJobId(intact!.id))).toBe('delayed');
  });
});
