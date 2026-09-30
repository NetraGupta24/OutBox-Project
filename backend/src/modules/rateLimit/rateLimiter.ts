/**
 * Per-sender rate limiting, shared by every worker process through Redis.
 *
 * One Lua script runs atomically for each send attempt. It:
 *   1. picks the sender's next free send slot: max(now, last reservation + MIN_SEND_INTERVAL_MS)
 *   2. checks two counters for the window that slot falls in:
 *        the sender's count   (cap: MAX_EMAILS_PER_HOUR_PER_SENDER or the sender's own limit)
 *        the campaign's count (cap: the campaign's hourly limit from Compose)
 *   3a. under both limits: counts the email and reserves the slot
 *   3b. at a limit: moves the email to the first later window with room, counting
 *       emails already waiting there, and gives it the next position in that
 *       window. Nothing is dropped, and an email is normally moved only once.
 *
 * Order: emails deferred into a window are first in line there. While any are
 * still waiting, a newly due email joins the back of that window's queue (or a
 * later window, if this one is fully booked) instead of going straight out. So
 * a later email can't overtake an earlier one, even when the backlog spans
 * several windows.
 *
 * A window never holds more than fit at the minimum interval
 * (window / MIN_SEND_INTERVAL_MS), whatever the configured limits say.
 *
 * Windows are fixed, aligned blocks of RATE_LIMIT_WINDOW_MS (an hour by default),
 * the same windows the schedule planner uses. Keys share the sender's hash tag
 * ({s:<id>}), so one script only ever touches one sender's keys.
 */
import type { Redis } from 'ioredis';
import { redis as defaultRedis } from '../../lib/redis.js';

const RESERVE_SCRIPT = `
local slotKey = KEYS[1]
local now = tonumber(ARGV[1])
local prefix = ARGV[2]
local campaignId = ARGV[3]
local senderLimit = tonumber(ARGV[4])
local campaignLimit = tonumber(ARGV[5])
local interval = tonumber(ARGV[6])
local windowMs = tonumber(ARGV[7])
local deferredWindow = tonumber(ARGV[8])
local campaignPrefix = prefix .. ':c:' .. campaignId

-- A window can't hold more sends than fit at the minimum interval.
local step = interval
if step < 1 then step = 1 end
local fits = math.floor(windowMs / step)
if senderLimit > fits then senderLimit = fits end
if campaignLimit > fits then campaignLimit = fits end

local function num(key)
  return tonumber(redis.call('GET', key) or '0')
end
-- Keys for window w live until the window after it has ended.
local function ttl(w)
  return (w + 2) * windowMs - now
end
local function bump(key, w)
  local n = redis.call('INCR', key)
  redis.call('PEXPIRE', key, ttl(w))
  return n
end
-- Emails deferred into window w that haven't come back yet.
local function waiting(p, w)
  local n = num(p .. ':ovf:' .. w) - num(p .. ':back:' .. w)
  if n < 0 then return 0 end
  return n
end
local function hasRoom(p, w, limit)
  return num(p .. ':w:' .. w) + waiting(p, w) < limit
end

-- A deferred email coming back is no longer waiting.
if deferredWindow >= 0 then
  bump(prefix .. ':back:' .. deferredWindow, deferredWindow)
  bump(campaignPrefix .. ':back:' .. deferredWindow, deferredWindow)
end

local slot = num(slotKey)
if slot < now then slot = now end
local window = math.floor(slot / windowMs)

local senderCount = num(prefix .. ':w:' .. window)
local campaignCount = num(campaignPrefix .. ':w:' .. window)
-- New emails queue behind emails already deferred into this window, so a later
-- email can't overtake an earlier one. Deferred emails don't wait again.
local senderAhead = 0
local campaignAhead = 0
if deferredWindow < 0 then
  senderAhead = waiting(prefix, window)
  campaignAhead = waiting(campaignPrefix, window)
end

local senderFull = senderCount + senderAhead >= senderLimit
local campaignFull = campaignCount + campaignAhead >= campaignLimit
-- Room in this window, but earlier emails are still waiting for their turn in
-- it: join the back of this window's queue instead of going first.
local queueBehind = senderAhead > 0 or campaignAhead > 0

if senderFull or campaignFull or queueBehind then
  local target = window
  if senderFull or campaignFull then
    -- Find the first later window with room on both the sender and the campaign,
    -- counting emails already waiting there. Pointers remember windows known
    -- to be full, so long backlogs aren't rescanned on every call.
    local function firstFree(p, limit)
      local w = num(p .. ':free')
      if w <= window then w = window + 1 end
      while not hasRoom(p, w, limit) do w = w + 1 end
      redis.call('SET', p .. ':free', w, 'PX', ttl(w))
      return w
    end
    target = math.max(firstFree(prefix, senderLimit), firstFree(campaignPrefix, campaignLimit))
    while not (hasRoom(prefix, target, senderLimit) and hasRoom(campaignPrefix, target, campaignLimit)) do
      target = target + 1
    end
  end

  local position = bump(prefix .. ':ovf:' .. target, target)
  bump(campaignPrefix .. ':ovf:' .. target, target)
  local retryAt = target * windowMs + (position - 1) * step
  if retryAt < now then retryAt = now end
  local scope = 'queue'
  if senderFull then scope = 'sender' elseif campaignFull then scope = 'campaign' end
  return {'deferred', retryAt, window, scope, senderCount, campaignCount, target}
end

senderCount = bump(prefix .. ':w:' .. window, window)
campaignCount = bump(campaignPrefix .. ':w:' .. window, window)
redis.call('SET', slotKey, slot + interval, 'PX', (slot + interval - now) + windowMs)
-- Flags for the email that takes the last place in the window.
local senderReached = 0
if senderCount + senderAhead == senderLimit then senderReached = 1 end
local campaignReached = 0
if campaignCount + campaignAhead == campaignLimit then campaignReached = 1 end
return {'reserved', slot, window, 'none', senderCount, campaignCount, senderReached, campaignReached}
`;

export type ReserveInput = {
  now: number;
  senderId: number | string;
  campaignId: number | string;
  senderLimit: number;
  campaignLimit: number;
  minIntervalMs: number;
  windowMs: number;
  // Set when this email was deferred earlier: the window it was moved into.
  deferredFrom?: { window: number };
};

export type Reservation =
  | {
      kind: 'reserved';
      sendAt: number; // when to send (>= now); later than now when spacing requires it
      window: number;
      senderCount: number;
      campaignCount: number;
      // True for exactly the email that used the last place in the window.
      reachedSenderLimit: boolean;
      reachedCampaignLimit: boolean;
    }
  | {
      kind: 'deferred';
      retryAt: number; // in the first window with room, ordered by arrival
      window: number; // the full window
      targetWindow: number; // the window it was moved into (pass back as deferredFrom)
      // 'sender' / 'campaign': that limit was hit. 'queue': no limit was hit, but
      // earlier emails are waiting in this window, so this one goes after them.
      scope: 'sender' | 'campaign' | 'queue';
      senderCount: number;
      campaignCount: number;
    };

const senderPrefix = (senderId: number | string) => `rl:{s:${senderId}}`;

type ReserveCommand = (
  slotKey: string,
  ...args: (string | number)[]
) => Promise<[string, number, number, string, number, number, number, number?]>;

function command(client: Redis): ReserveCommand {
  const withCommand = client as Redis & { reserveSendSlot?: ReserveCommand };
  if (!withCommand.reserveSendSlot) {
    client.defineCommand('reserveSendSlot', { numberOfKeys: 1, lua: RESERVE_SCRIPT });
  }
  return withCommand.reserveSendSlot!.bind(client);
}

export async function reserveSendSlot(
  input: ReserveInput,
  client: Redis = defaultRedis,
): Promise<Reservation> {
  const prefix = senderPrefix(input.senderId);
  const [kind, time, window, scope, senderCount, campaignCount, extra, campaignReached] =
    await command(client)(
      `${prefix}:slot`,
      input.now,
      prefix,
      input.campaignId,
      input.senderLimit,
      input.campaignLimit,
      input.minIntervalMs,
      input.windowMs,
      input.deferredFrom?.window ?? -1,
    );

  if (kind === 'deferred') {
    return {
      kind,
      retryAt: time,
      window,
      targetWindow: extra,
      scope: scope as 'sender' | 'campaign' | 'queue',
      senderCount,
      campaignCount,
    };
  }
  return {
    kind: 'reserved',
    sendAt: time,
    window,
    senderCount,
    campaignCount,
    reachedSenderLimit: extra === 1,
    reachedCampaignLimit: campaignReached === 1,
  };
}

const RELEASE_SCRIPT = `
local ttl = tonumber(ARGV[1])
for _, key in ipairs(KEYS) do
  redis.call('INCR', key)
  redis.call('PEXPIRE', key, ttl)
end
return 1
`;

/**
 * An email deferred into a window was cancelled before it came back: count it
 * as back, as the reserve script does when a deferred email returns, so the
 * window's queue doesn't keep waiting for it.
 */
export async function releaseDeferral(
  input: { senderId: number; campaignId: number; window: number; windowMs: number; now?: number },
  client: Redis = defaultRedis,
): Promise<void> {
  const prefix = senderPrefix(input.senderId);
  const now = input.now ?? Date.now();
  const ttl = Math.max(1, (input.window + 2) * input.windowMs - now);
  await client.eval(
    RELEASE_SCRIPT,
    2,
    `${prefix}:back:${input.window}`,
    `${prefix}:c:${input.campaignId}:back:${input.window}`,
    ttl,
  );
}

// How many emails a sender has used in the window containing `now`.
export async function senderUsage(
  senderId: number,
  now: number,
  windowMs: number,
  client: Redis = defaultRedis,
): Promise<{ used: number; windowStart: number; windowEnd: number }> {
  const window = Math.floor(now / windowMs);
  const used = Number((await client.get(`${senderPrefix(senderId)}:w:${window}`)) ?? 0);
  return { used, windowStart: window * windowMs, windowEnd: (window + 1) * windowMs };
}
