import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { redis } from '../../lib/redis.js';
import {
  releaseDeferral,
  reserveSendSlot,
  senderUsage,
  type Reservation,
  type ReserveInput,
} from './rateLimiter.js';

const HOUR = 3_600_000;
const T0 = Date.parse('2030-01-01T10:15:00Z');
const NEXT_WINDOW = Date.parse('2030-01-01T11:00:00Z');

const base: Omit<ReserveInput, 'now'> = {
  senderId: 1,
  campaignId: 1,
  senderLimit: 3,
  campaignLimit: 100,
  minIntervalMs: 2000,
  windowMs: HOUR,
};

beforeEach(async () => {
  await redis.flushdb();
});

afterAll(async () => {
  await redis.quit();
});

describe('reserveSendSlot', () => {
  it('reserves up to the sender limit, spaced by the minimum interval', async () => {
    const results: Reservation[] = [];
    for (let i = 0; i < 3; i++) results.push(await reserveSendSlot({ ...base, now: T0 }));

    expect(results.map((r) => r.kind)).toEqual(['reserved', 'reserved', 'reserved']);
    expect(results.map((r) => (r.kind === 'reserved' ? r.sendAt - T0 : null))).toEqual([
      0, 2000, 4000,
    ]);
    // Only the email that takes the last place reports the limit as reached.
    expect(results.map((r) => r.kind === 'reserved' && r.reachedSenderLimit)).toEqual([
      false,
      false,
      true,
    ]);
  });

  it('defers overflow to the next window in arrival order, without dropping any', async () => {
    const results: Reservation[] = [];
    for (let i = 0; i < 6; i++) results.push(await reserveSendSlot({ ...base, now: T0 }));

    const deferred = results.slice(3);
    expect(deferred.every((r) => r.kind === 'deferred' && r.scope === 'sender')).toBe(true);
    expect(deferred.map((r) => (r.kind === 'deferred' ? r.retryAt - NEXT_WINDOW : null))).toEqual([
      0, 2000, 4000,
    ]);
  });

  it('lets deferred emails through, in order, once the next window starts', async () => {
    for (let i = 0; i < 3; i++) await reserveSendSlot({ ...base, now: T0 });
    const d1 = await reserveSendSlot({ ...base, now: T0 });
    const d2 = await reserveSendSlot({ ...base, now: T0 });
    if (d1.kind !== 'deferred' || d2.kind !== 'deferred') throw new Error('expected deferrals');

    const r1 = await reserveSendSlot({
      ...base,
      now: d1.retryAt,
      deferredFrom: { window: d1.targetWindow },
    });
    const r2 = await reserveSendSlot({
      ...base,
      now: d2.retryAt,
      deferredFrom: { window: d2.targetWindow },
    });
    expect(r1).toMatchObject({ kind: 'reserved', sendAt: d1.retryAt, senderCount: 1 });
    expect(r2).toMatchObject({ kind: 'reserved', sendAt: d2.retryAt, senderCount: 2 });
  });

  it('sends emails deferred into a window before emails that became due there', async () => {
    // Fill 10:xx and defer two emails into 11:xx.
    for (let i = 0; i < 3; i++) await reserveSendSlot({ ...base, now: T0 });
    const d1 = await reserveSendSlot({ ...base, now: T0 });
    const d2 = await reserveSendSlot({ ...base, now: T0 });
    if (d1.kind !== 'deferred' || d2.kind !== 'deferred') throw new Error('expected deferrals');

    // A newer email planned for 11:00:00 arrives before the deferred ones come back.
    const fresh = await reserveSendSlot({ ...base, now: NEXT_WINDOW });
    // There is room in 11:xx, but it must queue behind the two waiting emails.
    expect(fresh).toMatchObject({ kind: 'deferred', scope: 'queue', retryAt: NEXT_WINDOW + 4000 });
  });

  it('keeps order when the backlog spans several windows', async () => {
    const input = { ...base, senderLimit: 2 };
    const results: Reservation[] = [];
    for (let i = 0; i < 7; i++) results.push(await reserveSendSlot({ ...input, now: T0 }));

    expect(results.slice(0, 2).every((r) => r.kind === 'reserved')).toBe(true);
    // Each deferred email goes straight to the first window with room: 2 per window.
    const retries = results.slice(2).map((r) => (r.kind === 'deferred' ? r.retryAt : null));
    expect(retries).toEqual([
      NEXT_WINDOW,
      NEXT_WINDOW + 2000,
      NEXT_WINDOW + HOUR,
      NEXT_WINDOW + HOUR + 2000,
      NEXT_WINDOW + 2 * HOUR,
    ]);
  });

  it('never puts more sends in a window than fit at the minimum interval', async () => {
    // 10 s windows at 2 s spacing hold at most 5 sends, whatever the limit says.
    const input = { ...base, senderLimit: 100, windowMs: 10_000 };
    const start = Math.ceil(T0 / 10_000) * 10_000;
    const results: Reservation[] = [];
    for (let i = 0; i < 7; i++) results.push(await reserveSendSlot({ ...input, now: start }));

    const sendTimes = results.map((r) => (r.kind === 'reserved' ? r.sendAt - start : null));
    expect(sendTimes).toEqual([0, 2000, 4000, 6000, 8000, 10_000, 12_000]);
    const windows = results.map((r) => r.window - results[0]!.window);
    expect(windows).toEqual([0, 0, 0, 0, 0, 1, 1]);
  });

  it("applies a campaign's limit without blocking other campaigns on the same sender", async () => {
    const input = { ...base, senderLimit: 10, campaignLimit: 2 };
    const a1 = await reserveSendSlot({ ...input, campaignId: 'A', now: T0 });
    const a2 = await reserveSendSlot({ ...input, campaignId: 'A', now: T0 });
    const a3 = await reserveSendSlot({ ...input, campaignId: 'A', now: T0 });
    const b1 = await reserveSendSlot({ ...input, campaignId: 'B', now: T0 });

    expect([a1.kind, a2.kind, a3.kind, b1.kind]).toEqual([
      'reserved',
      'reserved',
      'deferred',
      'reserved',
    ]);
    expect(a2.kind === 'reserved' && a2.reachedCampaignLimit).toBe(true);
    expect(a3.kind === 'deferred' && a3.scope).toBe('campaign');
    // B still honours the sender's spacing after A's two sends.
    expect(b1.kind === 'reserved' && b1.sendAt - T0).toBe(4000);
  });

  it('never exceeds the limit under 200 parallel reservations', async () => {
    const input = { ...base, senderLimit: 50 };
    const results = await Promise.all(
      Array.from({ length: 200 }, () => reserveSendSlot({ ...input, now: T0 })),
    );

    const reserved = results.flatMap((r) => (r.kind === 'reserved' ? [r.sendAt] : []));
    const deferred = results.flatMap((r) => (r.kind === 'deferred' ? [r.retryAt] : []));
    expect(reserved).toHaveLength(50);
    expect(deferred).toHaveLength(150);

    // Every reserved slot is distinct and exactly 2 s apart.
    const slots = [...reserved].sort((a, b) => a - b);
    expect(slots.every((t, i) => t === T0 + i * 2000)).toBe(true);
    // The 150 deferred emails fill the next three windows, 50 each, every one
    // with its own position.
    const retries = [...deferred].sort((a, b) => a - b);
    const expected = Array.from(
      { length: 150 },
      (_, i) => NEXT_WINDOW + Math.floor(i / 50) * HOUR + (i % 50) * 2000,
    );
    expect(retries).toEqual(expected);
  });

  it('starts counting again in each new window', async () => {
    for (let i = 0; i < 3; i++) await reserveSendSlot({ ...base, now: T0 });
    const later = await reserveSendSlot({ ...base, now: NEXT_WINDOW + 10 * 60_000 });
    expect(later).toMatchObject({ kind: 'reserved', senderCount: 1 });
  });

  it('reports usage for the current window', async () => {
    for (let i = 0; i < 2; i++) await reserveSendSlot({ ...base, now: T0 });
    const usage = await senderUsage(1, T0, HOUR);
    expect(usage).toEqual({
      used: 2,
      windowStart: Date.parse('2030-01-01T10:00:00Z'),
      windowEnd: NEXT_WINDOW,
    });
  });
});

describe('releaseDeferral', () => {
  // Fills a window (limit 2), defers a third email into the next window, and
  // returns that window.
  async function deferOne(senderId: number) {
    const limited = { ...base, senderId, senderLimit: 2 };
    await reserveSendSlot({ ...limited, now: T0 });
    await reserveSendSlot({ ...limited, now: T0 });
    const deferred = await reserveSendSlot({ ...limited, now: T0 });
    expect(deferred).toMatchObject({ kind: 'deferred', scope: 'sender' });
    return deferred.kind === 'deferred' ? deferred.targetWindow : -1;
  }

  it('stops later emails queueing behind a deferred email that was cancelled', async () => {
    // Not released: a new email in that window queues behind the deferred one.
    await deferOne(1);
    const behind = await reserveSendSlot({
      ...base,
      senderId: 1,
      senderLimit: 2,
      campaignId: 9,
      now: NEXT_WINDOW,
    });
    expect(behind).toMatchObject({ kind: 'deferred', scope: 'queue' });

    // Released (the deferred email was cancelled): the new email goes straight out.
    const target = await deferOne(2);
    await releaseDeferral({ senderId: 2, campaignId: 1, window: target, windowMs: HOUR, now: T0 });
    const fresh = await reserveSendSlot({
      ...base,
      senderId: 2,
      senderLimit: 2,
      campaignId: 9,
      now: NEXT_WINDOW,
    });
    expect(fresh).toMatchObject({ kind: 'reserved', sendAt: NEXT_WINDOW });
  });
});
