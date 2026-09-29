/**
 * Pure scheduling math for the campaign API and the Compose preview.
 * Rate-limit windows are fixed, aligned blocks of `windowMs` (UTC hours by
 * default): the same windows the worker's Redis counters use.
 */
export const HOUR_MS = 3_600_000;

export function windowStart(ms: number, windowMs = HOUR_MS): number {
  return Math.floor(ms / windowMs) * windowMs;
}

export type PlanInput = {
  count: number;
  startAt: number; // epoch ms
  delayMs: number; // gap between consecutive emails
  hourlyLimit: number; // max emails in one window
  windowMs?: number; // window length, one hour by default
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
export function planSchedule({
  count,
  startAt,
  delayMs,
  hourlyLimit,
  windowMs = HOUR_MS,
}: PlanInput): Plan {
  if (count <= 0) return { times: [], finishAt: null, windowsUsed: 0 };
  if (hourlyLimit < 1) throw new Error('hourlyLimit must be at least 1');

  const times: number[] = new Array(count);
  let t = startAt;
  let window = windowStart(t, windowMs);
  let inWindow = 0;
  let windowsUsed = 1;

  for (let i = 0; i < count; i++) {
    if (i > 0) t += delayMs;

    const w = windowStart(t, windowMs);
    if (w !== window) {
      window = w;
      inWindow = 0;
      windowsUsed++;
    }
    if (inWindow >= hourlyLimit) {
      window += windowMs;
      t = window;
      inWindow = 0;
      windowsUsed++;
    }

    times[i] = t;
    inWindow++;
  }

  return { times, finishAt: times[count - 1] ?? null, windowsUsed };
}
