/**
 * Pure scheduling math shared by the campaign API (and later the rate
 * limiter and the Compose preview). Rate-limit windows are fixed UTC hours,
 * the same windows the worker's Redis counters use.
 */
export const HOUR_MS = 3_600_000;

export function hourWindowStart(ms: number): number {
  return Math.floor(ms / HOUR_MS) * HOUR_MS;
}

export type PlanInput = {
  count: number;
  startAt: number; // epoch ms
  delayMs: number; // gap between consecutive emails
  hourlyLimit: number; // max emails in one UTC hour window
};

export type Plan = {
  times: number[]; // epoch ms, one per email, non-decreasing
  finishAt: number | null;
  windowsUsed: number;
};

/**
 * Spaces emails `delayMs` apart from `startAt`. When a window already holds
 * `hourlyLimit` emails, the next email moves to the start of the next window,
 * so order is preserved and nothing is dropped.
 */
export function planSchedule({ count, startAt, delayMs, hourlyLimit }: PlanInput): Plan {
  if (count <= 0) return { times: [], finishAt: null, windowsUsed: 0 };
  if (hourlyLimit < 1) throw new Error('hourlyLimit must be at least 1');

  const times: number[] = new Array(count);
  let t = startAt;
  let window = hourWindowStart(t);
  let inWindow = 0;
  let windowsUsed = 1;

  for (let i = 0; i < count; i++) {
    if (i > 0) t += delayMs;

    const w = hourWindowStart(t);
    if (w !== window) {
      window = w;
      inWindow = 0;
      windowsUsed++;
    }
    if (inWindow >= hourlyLimit) {
      window += HOUR_MS;
      t = window;
      inWindow = 0;
      windowsUsed++;
    }

    times[i] = t;
    inWindow++;
  }

  return { times, finishAt: times[count - 1] ?? null, windowsUsed };
}
