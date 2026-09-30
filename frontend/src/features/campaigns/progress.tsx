import type { CampaignListItem, EmailStatus } from '@/types/api';

// Bar segments, in send order: done first, then what's still to go.
const SEGMENTS: { status: EmailStatus; label: string; className: string }[] = [
  { status: 'sent', label: 'Sent', className: 'bg-brand-500' },
  { status: 'failed', label: 'Failed', className: 'bg-red-500' },
  { status: 'cancelled', label: 'Cancelled', className: 'bg-ink-muted/40' },
  { status: 'sending', label: 'Sending', className: 'bg-sky-400' },
  { status: 'delayed', label: 'Delayed', className: 'bg-amber-400' },
  { status: 'scheduled', label: 'Scheduled', className: 'bg-scheduled-600/25' },
];

export function pendingCount(c: CampaignListItem): number {
  return c.counts.scheduled + c.counts.delayed + c.counts.sending;
}

type CampaignState = { label: string; className: string };

export function campaignState(c: CampaignListItem, now = Date.now()): CampaignState {
  const pending = pendingCount(c);
  const done = c.counts.sent + c.counts.failed + c.counts.cancelled;
  if (pending > 0) {
    if (c.counts.delayed > 0 && c.counts.sending === 0) {
      return { label: 'Waiting for limit', className: 'bg-amber-50 text-amber-700' };
    }
    if (done > 0 || c.counts.sending > 0 || Date.parse(c.startAt) <= now) {
      return { label: 'Sending', className: 'bg-sky-50 text-sky-700' };
    }
    return { label: 'Scheduled', className: 'bg-scheduled-50 text-scheduled-600' };
  }
  if (c.counts.cancelled === c.total) {
    return { label: 'Cancelled', className: 'bg-muted text-ink-muted' };
  }
  if (c.counts.failed > 0) {
    return { label: 'Finished with errors', className: 'bg-red-50 text-red-700' };
  }
  if (c.counts.cancelled > 0) {
    return { label: 'Stopped', className: 'bg-muted text-ink-muted' };
  }
  return { label: 'Completed', className: 'bg-brand-50 text-brand-600' };
}

export function StateBadge({ campaign }: { campaign: CampaignListItem }) {
  const { label, className } = campaignState(campaign);
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${className}`}
    >
      {label}
    </span>
  );
}

export function ProgressBar({
  campaign,
  size = 'sm',
}: {
  campaign: CampaignListItem;
  size?: 'sm' | 'md';
}) {
  const total = Math.max(campaign.total, 1);
  const done = campaign.counts.sent + campaign.counts.failed + campaign.counts.cancelled;
  return (
    <div
      role="progressbar"
      aria-label="Campaign progress"
      aria-valuemin={0}
      aria-valuemax={campaign.total}
      aria-valuenow={done}
      aria-valuetext={`${done} of ${campaign.total} done`}
      className={`flex w-full gap-px overflow-hidden rounded-full bg-muted ${size === 'md' ? 'h-2.5' : 'h-1.5'}`}
    >
      {SEGMENTS.map(({ status, label, className }) => {
        const n = campaign.counts[status];
        if (n === 0) return null;
        return (
          <span
            key={status}
            title={`${label}: ${n.toLocaleString()}`}
            className={`h-full transition-[width] duration-500 ${className}`}
            style={{ width: `${(n / total) * 100}%` }}
          />
        );
      })}
    </div>
  );
}

export function ProgressLegend({ campaign }: { campaign: CampaignListItem }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
      {SEGMENTS.filter(({ status }) => campaign.counts[status] > 0).map(
        ({ status, label, className }) => (
          <li key={status} className="flex items-center gap-1.5">
            <span className={`size-2 rounded-full ${className}`} aria-hidden="true" />
            {label}
            <span className="font-medium text-ink tabular-nums">
              {campaign.counts[status].toLocaleString()}
            </span>
          </li>
        ),
      )}
    </ul>
  );
}
