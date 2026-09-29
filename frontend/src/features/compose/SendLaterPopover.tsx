'use client';

import { useEffect, useMemo, useRef } from 'react';
import { CalendarClock, Check } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { formatDuration, formatFull, formatShort, plural, windowName } from '@/lib/format';
import type { CampaignPreview } from '@/types/api';

type Preset = { label: string; value: Date | null };

function at(day: Date, hours: number): Date {
  const d = new Date(day);
  d.setHours(hours, 0, 0, 0);
  return d;
}

function presets(now: Date): Preset[] {
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const inAnHour = new Date(Math.ceil((now.getTime() + 3_600_000) / 300_000) * 300_000);
  const monday = new Date(now);
  monday.setDate(now.getDate() + ((8 - now.getDay()) % 7 || 7));
  const list: Preset[] = [
    { label: 'Now', value: null },
    { label: 'In 1 hour', value: inAnHour },
    { label: 'Tomorrow, 9:00 AM', value: at(tomorrow, 9) },
    { label: 'Tomorrow, 11:00 AM', value: at(tomorrow, 11) },
    { label: 'Tomorrow, 3:00 PM', value: at(tomorrow, 15) },
  ];
  if (monday.toDateString() !== tomorrow.toDateString()) {
    list.push({ label: 'Monday, 9:00 AM', value: at(monday, 9) });
  }
  return list;
}

// Value for <input type="datetime-local"> in local time.
function toLocalInput(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

type Props = {
  startAt: Date | null;
  onStartAtChange: (value: Date | null) => void;
  onClose: () => void;
  onSchedule: () => void;
  submitting: boolean;
  recipients: number;
  preview: CampaignPreview | null;
  previewLoading: boolean;
};

export function SendLaterPopover({
  startAt,
  onStartAtChange,
  onClose,
  onSchedule,
  submitting,
  recipients,
  preview,
  previewLoading,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const options = useMemo(() => presets(new Date()), []);
  const minInput = toLocalInput(new Date());

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (
        !ref.current?.contains(e.target as Node) &&
        !(e.target as HTMLElement).closest('[data-send-later-trigger]')
      )
        onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const selected = (p: Preset) =>
    p.value === null ? startAt === null : startAt?.getTime() === p.value.getTime();
  const duration = preview?.finishAt
    ? new Date(preview.finishAt).getTime() - new Date(preview.startAt).getTime()
    : 0;

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Send later"
      className="absolute top-full right-0 z-30 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-border bg-surface p-4 shadow-xl"
    >
      <h2 className="text-sm font-semibold text-ink">Send Later</h2>

      <label className="mt-3 flex items-center gap-2 border-b border-border pb-2 text-[13px]">
        <span className="sr-only">Pick date &amp; time</span>
        <input
          type="datetime-local"
          min={minInput}
          value={startAt ? toLocalInput(startAt) : ''}
          onChange={(e) => onStartAtChange(e.target.value ? new Date(e.target.value) : null)}
          className="min-w-0 flex-1 bg-transparent text-ink outline-none"
        />
        <CalendarClock className="size-4 shrink-0 text-ink-muted" aria-hidden="true" />
      </label>

      <ul className="mt-2 space-y-0.5">
        {options.map((p) => (
          <li key={p.label}>
            <button
              type="button"
              onClick={() => onStartAtChange(p.value)}
              className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[13px] transition-colors ${
                selected(p) ? 'bg-brand-50 font-medium text-ink' : 'text-ink/80 hover:bg-muted'
              }`}
            >
              {p.label}
              {selected(p) && <Check className="size-3.5 text-brand-600" />}
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-3 rounded-lg bg-muted px-3 py-2.5 text-xs text-ink-muted">
        {previewLoading && !preview ? (
          <span className="inline-flex items-center gap-2">
            <Spinner className="size-3" /> Working out the schedule…
          </span>
        ) : preview ? (
          <>
            <p className="text-[13px] font-medium text-ink">
              {plural(recipients, 'email')},{' '}
              {startAt ? `from ${formatShort(preview.startAt)}` : 'starting now'}
            </p>
            {preview.finishAt && recipients > 1 && (
              <p className="mt-0.5" title={formatFull(preview.finishAt)}>
                Last one around {formatShort(preview.finishAt)} (about {formatDuration(duration)})
              </p>
            )}
            <p className="mt-0.5">
              {preview.effectiveDelayMs / 1000} s apart, at most{' '}
              {preview.effectiveHourlyLimit.toLocaleString()} per {windowName(preview.windowMs)}
            </p>
          </>
        ) : (
          <span>Add recipients to see when your emails will go out.</span>
        )}
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button size="sm" pill onClick={onSchedule} loading={submitting}>
          {startAt ? 'Schedule' : 'Send now'}
        </Button>
      </div>
    </div>
  );
}
