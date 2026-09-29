import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { redis } from '../../lib/redis.js';
import { emailQueue, notificationQueue, searchIndexQueue } from '../../queue/queues.js';
import { createCampaign } from '../campaigns/campaign.service.js';
import { listEmails } from '../emails/email.service.js';
import { createUserAndSender, resetDatabase } from '../../../test/helpers.js';
import { deleteEmailIndex, indexEmails } from './emailIndex.js';
import * as emailIndex from './emailIndex.js';

let userId: number;
let senderId: number;

async function schedule(owner: number, subject: string, body: string, recipients: string[]) {
  const { campaign } = await createCampaign(owner, {
    senderId,
    subject,
    bodyHtml: `<p>${body}</p>`,
    recipients,
    startAt: new Date(Date.now() + 24 * 3_600_000).toISOString(),
    delayMs: 2000,
    hourlyLimit: 100,
  });
  const ids = (
    await prisma.email.findMany({ where: { campaignId: campaign.id }, select: { id: true } })
  ).map((e) => e.id);
  await indexEmails(ids, { refresh: true });
  return ids;
}

const search = (q: string, extra: Partial<Parameters<typeof listEmails>[1]> = {}, owner = userId) =>
  listEmails(owner, { tab: 'scheduled', page: 1, pageSize: 25, q, ...extra });

beforeAll(async () => {
  await deleteEmailIndex();
});

beforeEach(async () => {
  await resetDatabase();
  ({
    user: { id: userId },
    sender: { id: senderId },
  } = await createUserAndSender());
  vi.restoreAllMocks();
});

afterAll(async () => {
  await deleteEmailIndex();
  await Promise.allSettled([
    emailQueue.close(),
    notificationQueue.close(),
    searchIndexQueue.close(),
  ]);
  await Promise.allSettled([prisma.$disconnect(), redis.quit()]);
});

describe('search (Elasticsearch)', () => {
  it('matches recipients as you type, and subject and body words', async () => {
    await schedule(userId, 'Meeting follow-up', 'Thanks for the call about pricing', [
      'lead1@acme.com',
      'lead2@acme.com',
      'sarah@globex.com',
    ]);

    const lead = await search('lead');
    expect(lead.searchedWith).toBe('elasticsearch');
    expect(lead.items.map((e) => e.recipient).sort()).toEqual(['lead1@acme.com', 'lead2@acme.com']);

    expect((await search('sara')).items.map((e) => e.recipient)).toEqual(['sarah@globex.com']);
    expect((await search('follo')).total).toBe(3); // subject prefix
    expect((await search('pricing')).total).toBe(3); // body word
    expect((await search('nothing-like-this')).total).toBe(0);
  });

  it("only returns the signed-in user's emails", async () => {
    await schedule(userId, 'Mine', 'hello', ['shared@acme.com']);
    const other = await prisma.user.create({
      data: { email: 'other@x.com', googleId: 'other', name: 'Other' },
    });
    await schedule(other.id, 'Theirs', 'hello', ['shared@acme.com']);

    expect((await search('shared')).items.map((e) => e.subject)).toEqual(['Mine']);
    expect((await search('shared', {}, other.id)).items.map((e) => e.subject)).toEqual(['Theirs']);
  });

  it('keeps tab and status filters, using the latest state from MySQL', async () => {
    const [sentId] = await schedule(userId, 'Quarterly report', 'numbers', [
      'a@acme.com',
      'b@acme.com',
    ]);
    await prisma.email.update({ where: { id: sentId }, data: { status: 'failed', error: '550' } });
    await indexEmails([sentId!], { refresh: true });

    expect((await search('quarterly')).items.map((e) => e.recipient)).toEqual(['b@acme.com']);
    const failed = await search('quarterly', { tab: 'sent', status: 'failed' });
    expect(failed.items).toMatchObject([
      { recipient: 'a@acme.com', status: 'failed', error: '550' },
    ]);
  });

  it('falls back to MySQL when Elasticsearch is unavailable', async () => {
    await schedule(userId, 'Fallback test', 'body', ['fallback@acme.com']);
    vi.spyOn(emailIndex, 'searchEmailIds').mockRejectedValue(new Error('connect ECONNREFUSED'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await search('fallback');
    expect(result.searchedWith).toBe('database');
    expect(result.items.map((e) => e.recipient)).toEqual(['fallback@acme.com']);
  });
});
