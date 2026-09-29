import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../app.js';
import { decrypt } from '../../lib/crypto.js';
import { prisma } from '../../lib/prisma.js';
import { redis } from '../../lib/redis.js';
import { emailQueue, notificationQueue, searchIndexQueue } from '../../queue/queues.js';
import { createSessionToken } from '../auth/session.js';
import { createUserAndSender, resetDatabase } from '../../../test/helpers.js';
import { limitReachedMessage, notifyUser } from './slack.service.js';

// A local stand-in for a Slack incoming webhook.
const received: unknown[] = [];
let webhookStatus = 200;
let webhook: Server;
let webhookUrl: string;

let app: Server;
let base: string;
let session: string;
let userId: number;

const realFetch = globalThis.fetch;

// Slack's OAuth token endpoint is faked; every other request is real.
function fakeSlackOAuth(response: object) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === 'https://slack.com/api/oauth.v2.access') {
      return new Response(JSON.stringify(response), {
        headers: { 'content-type': 'application/json' },
      });
    }
    return realFetch(input, init);
  });
}

const call = (path: string, init: RequestInit = {}) =>
  realFetch(`${base}${path}`, {
    redirect: 'manual',
    ...init,
    headers: { cookie: `rb_session=${session}`, ...init.headers },
  });

async function connect() {
  fakeSlackOAuth({
    ok: true,
    team: { id: 'T1', name: 'Acme' },
    incoming_webhook: { url: webhookUrl, channel: '#alerts', channel_id: 'C1' },
  });
  const start = await call('/api/integrations/slack/connect');
  const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
  return call(`/api/integrations/slack/callback?code=abc&state=${encodeURIComponent(state)}`);
}

beforeAll(async () => {
  webhook = createServer((req: IncomingMessage, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (webhookStatus === 200) received.push(JSON.parse(body));
      res.writeHead(webhookStatus).end(webhookStatus === 200 ? 'ok' : 'no_service');
    });
  }).listen(0);
  app = createApp().listen(0);
  await Promise.all([webhook, app].map((s) => new Promise((r) => s.once('listening', r))));
  webhookUrl = `http://127.0.0.1:${(webhook.address() as AddressInfo).port}/services/T1/B1/secret`;
  base = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
});

beforeEach(async () => {
  await resetDatabase();
  ({
    user: { id: userId },
  } = await createUserAndSender());
  session = await createSessionToken(userId);
  received.length = 0;
  webhookStatus = 200;
  vi.restoreAllMocks();
});

afterAll(async () => {
  await Promise.all([webhook, app].map((s) => new Promise((r) => s.close(r))));
  await Promise.allSettled([
    emailQueue.close(),
    notificationQueue.close(),
    searchIndexQueue.close(),
  ]);
  await Promise.allSettled([prisma.$disconnect(), redis.quit()]);
});

describe('Connect Slack', () => {
  it('sends the user to Slack with the incoming-webhook scope and a signed state', async () => {
    const res = await call('/api/integrations/slack/connect');
    const url = new URL(res.headers.get('location')!);
    expect(url.origin + url.pathname).toBe('https://slack.com/oauth/v2/authorize');
    expect(url.searchParams.get('client_id')).toBe('test-slack-client');
    expect(url.searchParams.get('scope')).toBe('incoming-webhook');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'http://localhost:3000/api/integrations/slack/callback',
    );
    expect(url.searchParams.get('state')).toBeTruthy();
  });

  it('stores the channel webhook (encrypted) and reports the connection', async () => {
    const res = await connect();
    expect(res.headers.get('location')).toBe('http://localhost:3000/scheduled?slack=connected');

    const row = await prisma.slackIntegration.findUniqueOrThrow({ where: { userId } });
    expect(row.webhookUrlEnc).not.toContain('127.0.0.1');
    expect(decrypt(row.webhookUrlEnc)).toBe(webhookUrl);

    const status = await (await call('/api/integrations/slack')).json();
    expect(status).toMatchObject({
      configured: true,
      connected: true,
      teamName: 'Acme',
      channel: '#alerts',
    });
  });

  it('rejects a callback whose state was issued to another user', async () => {
    const other = await prisma.user.create({
      data: { email: 'o@x.com', googleId: 'o', name: 'O' },
    });
    const otherSession = await createSessionToken(other.id);
    const start = await realFetch(`${base}/api/integrations/slack/connect`, {
      redirect: 'manual',
      headers: { cookie: `rb_session=${otherSession}` },
    });
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!;

    const res = await call(
      `/api/integrations/slack/callback?code=abc&state=${encodeURIComponent(state)}`,
    );
    expect(res.headers.get('location')).toBe('http://localhost:3000/scheduled?slack=expired');
    expect(await prisma.slackIntegration.count()).toBe(0);
  });

  it('sends a real test message to the connected channel, and can disconnect', async () => {
    await connect();
    const test = await call('/api/integrations/slack/test', { method: 'POST' });
    expect(test.status).toBe(200);
    expect(received).toHaveLength(1);
    expect(JSON.stringify(received[0])).toContain('ReachInbox Scheduler is connected');

    expect((await call('/api/integrations/slack', { method: 'DELETE' })).status).toBe(204);
    expect((await (await call('/api/integrations/slack')).json()).connected).toBe(false);
    expect((await call('/api/integrations/slack/test', { method: 'POST' })).status).toBe(409);
  });
});

describe('limit alerts', () => {
  const alert = limitReachedMessage({
    scope: 'sender',
    senderEmail: 'alice@ethereal.email',
    campaignSubject: 'Meeting follow-up',
    limit: 200,
    windowStart: '2030-01-01T10:00:00.000Z',
    windowEnd: '2030-01-01T11:00:00.000Z',
    windowName: 'hour',
  });

  it('posts the alert to the connected channel', async () => {
    await connect();
    expect(await notifyUser(userId, alert)).toBe('sent');
    expect(JSON.stringify(received[0])).toContain('reached its limit of *200 emails per hour*');
  });

  it("skips users who haven't connected Slack, without failing", async () => {
    expect(await notifyUser(userId, alert)).toBe('not_connected');
    expect(received).toHaveLength(0);
  });

  it('marks a webhook Slack has removed as disconnected, and stops using it', async () => {
    await connect();
    webhookStatus = 404;
    expect(await notifyUser(userId, alert)).toBe('revoked');
    expect((await (await call('/api/integrations/slack')).json()).disconnectedBySlack).toBe(true);
    expect(await notifyUser(userId, alert)).toBe('not_connected');
  });

  it('throws on a temporary Slack error, so the queue retries', async () => {
    await connect();
    webhookStatus = 503;
    await expect(notifyUser(userId, alert)).rejects.toThrow('Slack answered 503');
  });
});
