/**
 * Slack alerts, per user. "Connect Slack" runs Slack's OAuth v2 flow with the
 * incoming-webhook scope: the user picks a channel, and we store the webhook
 * URL Slack returns (encrypted). Messages are posted to that webhook.
 */
import { randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { env } from '../../config/env.js';
import { decrypt, encrypt } from '../../lib/crypto.js';
import { prisma } from '../../lib/prisma.js';

const SLACK_AUTHORIZE_URL = 'https://slack.com/oauth/v2/authorize';
const SLACK_TOKEN_URL = 'https://slack.com/api/oauth.v2.access';
const STATE_TTL_SECONDS = 10 * 60;
const secret = new TextEncoder().encode(env.JWT_SECRET);

export function slackConfigured(): boolean {
  return Boolean(env.SLACK_CLIENT_ID && env.SLACK_CLIENT_SECRET);
}

// The state is signed and names the user who started the flow, so a callback
// can't attach someone else's Slack to this account (or ours to theirs).
export async function createSlackAuthUrl(userId: number): Promise<string> {
  const state = await new SignJWT({
    sub: String(userId),
    nonce: randomBytes(12).toString('base64url'),
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setAudience('slack-oauth')
    .setExpirationTime(`${STATE_TTL_SECONDS}s`)
    .sign(secret);
  const url = new URL(SLACK_AUTHORIZE_URL);
  url.searchParams.set('client_id', env.SLACK_CLIENT_ID!);
  url.searchParams.set('scope', 'incoming-webhook');
  url.searchParams.set('redirect_uri', env.SLACK_REDIRECT_URI);
  url.searchParams.set('state', state);
  return url.toString();
}

export async function readSlackState(state: string): Promise<number | null> {
  try {
    const { payload } = await jwtVerify(state, secret, { audience: 'slack-oauth' });
    const userId = Number(payload.sub);
    return Number.isInteger(userId) ? userId : null;
  } catch {
    return null;
  }
}

type OAuthAccessResponse = {
  ok: boolean;
  error?: string;
  team?: { id: string; name: string };
  incoming_webhook?: { url: string; channel: string; channel_id?: string };
};

export class SlackError extends Error {}

// Exchanges the one-time code for the channel's webhook, and saves it.
export async function connectSlack(userId: number, code: string) {
  const res = await fetch(SLACK_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.SLACK_CLIENT_ID!,
      client_secret: env.SLACK_CLIENT_SECRET!,
      code,
      redirect_uri: env.SLACK_REDIRECT_URI,
    }),
  });
  const body = (await res
    .json()
    .catch(() => ({ ok: false, error: `HTTP ${res.status}` }))) as OAuthAccessResponse;
  if (!body.ok || !body.incoming_webhook?.url) {
    throw new SlackError(`Slack sign-in failed: ${body.error ?? 'no webhook returned'}`);
  }

  const data = {
    teamId: body.team?.id ?? 'unknown',
    teamName: body.team?.name ?? 'Slack',
    channel: body.incoming_webhook.channel,
    webhookUrlEnc: encrypt(body.incoming_webhook.url),
    connectedAt: new Date(),
    revokedAt: null,
  };
  return prisma.slackIntegration.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });
}

export type SlackStatus = {
  configured: boolean;
  connected: boolean;
  teamName: string | null;
  channel: string | null;
  connectedAt: string | null;
  disconnectedBySlack: boolean; // the webhook stopped working, reconnect needed
};

export async function slackStatus(userId: number): Promise<SlackStatus> {
  const row = await prisma.slackIntegration.findUnique({ where: { userId } });
  return {
    configured: slackConfigured(),
    connected: !!row && !row.revokedAt,
    teamName: row?.teamName ?? null,
    channel: row?.channel ?? null,
    connectedAt: row?.connectedAt.toISOString() ?? null,
    disconnectedBySlack: !!row?.revokedAt,
  };
}

export async function disconnectSlack(userId: number): Promise<void> {
  await prisma.slackIntegration.deleteMany({ where: { userId } });
}

export type SlackMessage = { text: string; blocks?: unknown[] };
export type SlackResult = 'sent' | 'not_connected' | 'revoked';

// Slack's answers for a webhook that no longer works (channel gone, app removed).
const GONE = [403, 404, 410];

/**
 * Posts to the user's Slack. Users who haven't connected Slack are simply
 * skipped. A dead webhook is marked disconnected instead of retried. Other
 * failures throw, so the notification queue retries them.
 */
export async function notifyUser(userId: number, message: SlackMessage): Promise<SlackResult> {
  // Looked up on every message, so connecting or disconnecting takes effect at once.
  const row = await prisma.slackIntegration.findUnique({ where: { userId } });
  if (!row || row.revokedAt) return 'not_connected';

  const res = await fetch(decrypt(row.webhookUrlEnc), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(message),
  });
  if (res.ok) return 'sent';

  const reason = (await res.text().catch(() => '')).slice(0, 200);
  if (GONE.includes(res.status)) {
    await prisma.slackIntegration.update({ where: { userId }, data: { revokedAt: new Date() } });
    return 'revoked';
  }
  throw new SlackError(`Slack answered ${res.status}${reason ? `: ${reason}` : ''}`);
}

// Slack shows <!date^…> in each reader's own time zone.
function slackTime(iso: string, fallback: string): string {
  return `<!date^${Math.floor(new Date(iso).getTime() / 1000)}^{date_short_pretty} at {time}|${fallback}>`;
}

export function limitReachedMessage(event: {
  scope: 'sender' | 'campaign';
  senderEmail: string;
  campaignSubject: string;
  limit: number;
  windowStart: string;
  windowEnd: string;
  windowName: string;
}): SlackMessage {
  const who =
    event.scope === 'sender'
      ? `Sender *${event.senderEmail}* reached its limit of *${event.limit} emails per ${event.windowName}*.`
      : `Campaign *“${event.campaignSubject}”* reached its limit of *${event.limit} emails per ${event.windowName}* on ${event.senderEmail}.`;
  const resume = slackTime(event.windowEnd, event.windowEnd);
  const text = `Sending limit reached. ${who.replaceAll('*', '')} Remaining emails resume at ${event.windowEnd}.`;
  return {
    text,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: '⏸️ Sending limit reached' } },
      { type: 'section', text: { type: 'mrkdwn', text: who } },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `Nothing is dropped: the remaining emails are queued in order and resume at ${resume}.`,
          },
        ],
      },
    ],
  };
}

export function testMessage(channel: string | null): SlackMessage {
  return {
    text: 'ReachInbox Scheduler is connected. Sending-limit alerts will appear here.',
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `:white_check_mark: *ReachInbox Scheduler is connected*${channel ? ` to ${channel}` : ''}.\nYou'll get a message here whenever one of your senders reaches its hourly limit.`,
        },
      },
    ],
  };
}
