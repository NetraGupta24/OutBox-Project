import { describe, expect, it } from 'vitest';
import { HOUR_MS, hourWindowStart, planSchedule } from './schedulePlanner.js';

const at = (iso: string) => Date.parse(iso);
const iso = (ms: number) => new Date(ms).toISOString();

describe('hourWindowStart', () => {
  it('floors to the start of the UTC hour', () => {
    expect(iso(hourWindowStart(at('2026-10-01T10:59:59.999Z')))).toBe('2026-10-01T10:00:00.000Z');
    expect(iso(hourWindowStart(at('2026-10-01T11:00:00.000Z')))).toBe('2026-10-01T11:00:00.000Z');
  });
});

describe('planSchedule', () => {
  it('returns an empty plan for zero emails', () => {
    expect(planSchedule({ count: 0, startAt: 0, delayMs: 1000, hourlyLimit: 10 })).toEqual({
      times: [],
      finishAt: null,
      windowsUsed: 0,
    });
  });

  it('spaces emails by the delay when under the hourly limit', () => {
    const plan = planSchedule({
      count: 3,
      startAt: at('2026-10-01T10:00:00Z'),
      delayMs: 2000,
      hourlyLimit: 100,
    });
    expect(plan.times.map(iso)).toEqual([
      '2026-10-01T10:00:00.000Z',
      '2026-10-01T10:00:02.000Z',
      '2026-10-01T10:00:04.000Z',
    ]);
    expect(plan.windowsUsed).toBe(1);
  });

  it('moves overflow to the start of the next hour window, in order', () => {
    const plan = planSchedule({
      count: 5,
      startAt: at('2026-10-01T10:30:00Z'),
      delayMs: 1000,
      hourlyLimit: 2,
    });
    expect(plan.times.map(iso)).toEqual([
      '2026-10-01T10:30:00.000Z',
      '2026-10-01T10:30:01.000Z',
      '2026-10-01T11:00:00.000Z',
      '2026-10-01T11:00:01.000Z',
      '2026-10-01T12:00:00.000Z',
    ]);
    expect(plan.finishAt).toBe(at('2026-10-01T12:00:00Z'));
    expect(plan.windowsUsed).toBe(3);
  });

  it('resets the window count when the delay crosses an hour boundary', () => {
    const plan = planSchedule({
      count: 3,
      startAt: at('2026-10-01T10:59:59Z'),
      delayMs: 2000,
      hourlyLimit: 1,
    });
    expect(plan.times.map(iso)).toEqual([
      '2026-10-01T10:59:59.000Z',
      '2026-10-01T11:00:01.000Z',
      '2026-10-01T12:00:00.000Z',
    ]);
  });

  it('never puts more than hourlyLimit emails in one window (1,000 emails)', () => {
    const plan = planSchedule({
      count: 1000,
      startAt: at('2026-10-01T10:00:00Z'),
      delayMs: 2000,
      hourlyLimit: 200,
    });
    const perWindow = new Map<number, number>();
    for (const t of plan.times) {
      const w = hourWindowStart(t);
      perWindow.set(w, (perWindow.get(w) ?? 0) + 1);
    }
    expect([...perWindow.values()]).toEqual([200, 200, 200, 200, 200]);
    expect(plan.windowsUsed).toBe(5);
    expect(plan.times).toEqual([...plan.times].sort((a, b) => a - b));
    expect(plan.finishAt! - plan.times[0]!).toBeLessThan(5 * HOUR_MS);
  });

  it('rejects a non-positive hourly limit', () => {
    expect(() => planSchedule({ count: 1, startAt: 0, delayMs: 0, hourlyLimit: 0 })).toThrow();
  });
});
