// Date formatting in the viewer's own time zone.

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function sameDay(a: Date, b: Date) {
  return a.toDateString() === b.toDateString();
}

// "9:15 AM" today, "Tue 9:15 AM" this week, "Nov 3, 9:15 AM" otherwise.
export function formatShort(iso: string, { seconds = false } = {}, now = new Date()): string {
  const date = new Date(iso);
  const time = date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    ...(seconds ? { second: '2-digit' } : {}),
  });
  if (sameDay(date, now)) return time;
  if (Math.abs(date.getTime() - now.getTime()) < 6 * DAY) {
    return `${date.toLocaleDateString(undefined, { weekday: 'short' })} ${time}`;
  }
  return `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${time}`;
}

// "Tue, Nov 3, 2026, 9:15:12 AM"
export function formatFull(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
}

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

// "in 5 minutes", "2 hours ago", "just now"
export function formatRelative(iso: string, now = Date.now()): string {
  const diff = new Date(iso).getTime() - now;
  const abs = Math.abs(diff);
  if (abs < 45 * SECOND) return diff >= 0 ? 'in seconds' : 'just now';
  if (abs < HOUR) return relative.format(Math.round(diff / MINUTE), 'minute');
  if (abs < DAY) return relative.format(Math.round(diff / HOUR), 'hour');
  return relative.format(Math.round(diff / DAY), 'day');
}

export function formatDuration(ms: number): string {
  if (ms < MINUTE) return `${Math.max(1, Math.round(ms / SECOND))} s`;
  if (ms < HOUR) return `${Math.round(ms / MINUTE)} min`;
  const hours = Math.floor(ms / HOUR);
  const minutes = Math.round((ms % HOUR) / MINUTE);
  return minutes ? `${hours} h ${minutes} min` : `${hours} h`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

// "hour" for the normal rate-limit window; "minute" or "30 s window" in a demo setup.
export function windowName(ms: number): string {
  if (ms === HOUR) return 'hour';
  if (ms === MINUTE) return 'minute';
  return ms % MINUTE === 0 ? `${ms / MINUTE} min window` : `${Math.round(ms / SECOND)} s window`;
}
