import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { redis } from '../../lib/redis.js';
import { emailJobId, emailQueue, notificationQueue } from '../../queue/queues.js';
import { createCampaign } from '../campaigns/campaign.service.js';
import { getCampaign, listCampaigns } from '../campaigns/campaign.query.js';
import type { CampaignInput } from '../campaigns/campaign.schema.js';
import { cancelEmails, retryEmails } from './email.actions.js';
import { claimEmail } from './email.state.js';
import { countEmails, listEmails } from './email.service.js';
import { createUserAndSender, resetDatabase } from '../../../test/helpers.js';

let userId: number;
let senderId: number;

function input(recipients: string[], subject = 'Actions test'): CampaignInput {
  return {
    senderId,
    subject,
    bodyHtml: '<p>Hello</p>',
    recipients,
    startAt: new Date(Date.now() + 24 * 3_600_000).toISOString(),
    delayMs: 2000,
    hourlyLimit: 100,
  };
}

const jobState = (id: number) => emailQueue.getJobState(emailJobId(id));

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

describe('cancelEmails', () => {
  it('cancels a campaign’s pending emails and removes their jobs', async () => {
    const { campaign } = await createCampaign(userId, input(['a@x.com', 'b@x.com', 'c@x.com']));
    const emails = await prisma.email.findMany({ where: { campaignId: campaign.id } });
    // One is already being sent and one is sent: neither can be cancelled.
    await prisma.email.update({ where: { id: emails[0]!.id }, data: { status: 'sending' } });
    await prisma.email.update({ where: { id: emails[1]!.id }, data: { status: 'sent' } });

    const result = await cancelEmails({ userId, campaignId: campaign.id });

    expect(result).toEqual({ cancelled: 1 });
    const after = await prisma.email.findMany({
      where: { campaignId: campaign.id },
      orderBy: { id: 'asc' },
    });
    expect(after.map((e) => e.status)).toEqual(['sending', 'sent', 'cancelled']);
    expect(await jobState(emails[2]!.id)).toBe('unknown');
    expect(await jobState(emails[0]!.id)).toBe('delayed');
  });

  it('cancels a single email, and a claim on it is refused', async () => {
    const { campaign } = await createCampaign(userId, input(['a@x.com', 'b@x.com']));
    const [first, second] = await prisma.email.findMany({
      where: { campaignId: campaign.id },
      orderBy: { id: 'asc' },
    });

    expect(await cancelEmails({ userId, emailId: first!.id })).toEqual({ cancelled: 1 });
    expect(await claimEmail(first!.id)).toEqual({ kind: 'done', reason: 'already cancelled' });
    expect((await prisma.email.findUniqueOrThrow({ where: { id: second!.id } })).status).toBe(
      'scheduled',
    );
    // Cancelling again is a no-op.
    expect(await cancelEmails({ userId, emailId: first!.id })).toEqual({ cancelled: 0 });
  });

  it("returns 404 for another user's campaign", async () => {
    const { campaign } = await createCampaign(userId, input(['a@x.com']));
    const other = await prisma.user.create({
      data: { email: 'other@example.com', googleId: 'other-google-id', name: 'Other' },
    });

    await expect(cancelEmails({ userId: other.id, campaignId: campaign.id })).rejects.toMatchObject(
      { status: 404 },
    );
    expect(await prisma.email.count({ where: { status: 'cancelled' } })).toBe(0);
  });
});

describe('retryEmails', () => {
  it('reschedules failed emails now, with a fresh job', async () => {
    const { campaign } = await createCampaign(userId, input(['a@x.com', 'b@x.com']));
    const [failed, ok] = await prisma.email.findMany({
      where: { campaignId: campaign.id },
      orderBy: { id: 'asc' },
    });
    await prisma.email.update({
      where: { id: failed!.id },
      data: { status: 'failed', attempts: 3, error: '550 mailbox unavailable' },
    });
    await prisma.email.update({ where: { id: ok!.id }, data: { status: 'sent' } });

    const before = Date.now();
    expect(await retryEmails({ userId, campaignId: campaign.id })).toEqual({ retried: 1 });

    const row = await prisma.email.findUniqueOrThrow({ where: { id: failed!.id } });
    expect(row).toMatchObject({ status: 'scheduled', attempts: 0, error: null });
    expect(row.scheduledAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(['waiting', 'delayed']).toContain(await jobState(failed!.id));
    expect((await prisma.email.findUniqueOrThrow({ where: { id: ok!.id } })).status).toBe('sent');
  });
});

describe('campaign progress', () => {
  it('lists campaigns newest first with counts per status', async () => {
    const older = await createCampaign(userId, input(['a@x.com', 'b@x.com'], 'Older'));
    const newer = await createCampaign(userId, input(['c@x.com', 'd@x.com', 'e@x.com'], 'Newer'));
    const [c1] = await prisma.email.findMany({
      where: { campaignId: newer.campaign.id },
      orderBy: { id: 'asc' },
    });
    await prisma.email.update({
      where: { id: c1!.id },
      data: { status: 'sent', sentAt: new Date() },
    });
    await cancelEmails({ userId, campaignId: older.campaign.id });

    const list = await listCampaigns(userId, { page: 1, pageSize: 10 });

    expect(list.total).toBe(2);
    expect(list.items.map((c) => c.subject)).toEqual(['Newer', 'Older']);
    expect(list.items[0]!.counts).toMatchObject({ sent: 1, scheduled: 2, cancelled: 0 });
    expect(list.items[0]!.lastSentAt).not.toBeNull();
    expect(list.items[0]!.nextSendAt).not.toBeNull();
    expect(list.items[1]!.counts).toMatchObject({ cancelled: 2, scheduled: 0 });
    expect(list.items[1]!.nextSendAt).toBeNull();

    const detail = await getCampaign(userId, newer.campaign.id);
    expect(detail).toMatchObject({ total: 3, bodyHtml: '<p>Hello</p>' });

    const counts = await countEmails(userId);
    expect(counts).toMatchObject({ scheduled: 2, sent: 3, cancelled: 2 });

    const campaignEmails = await listEmails(userId, {
      tab: 'all',
      campaignId: newer.campaign.id,
      page: 1,
      pageSize: 10,
    });
    expect(campaignEmails.total).toBe(3);
  });
});
