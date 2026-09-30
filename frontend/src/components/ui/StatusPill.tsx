import { AlertCircle, Ban, CheckCircle2, Clock, Hourglass, Loader2 } from 'lucide-react';
import type { EmailStatus } from '@/types/api';

const STYLES: Record<EmailStatus, { className: string; label: string; icon: typeof Clock }> = {
  scheduled: { className: 'bg-scheduled-50 text-scheduled-600', label: 'Scheduled', icon: Clock },
  delayed: { className: 'bg-amber-50 text-amber-700', label: 'Delayed', icon: Hourglass },
  sending: { className: 'bg-sky-50 text-sky-700', label: 'Sending', icon: Loader2 },
  sent: { className: 'bg-muted text-ink/70', label: 'Sent', icon: CheckCircle2 },
  failed: { className: 'bg-red-50 text-red-700', label: 'Failed', icon: AlertCircle },
  cancelled: { className: 'bg-muted text-ink-muted', label: 'Cancelled', icon: Ban },
};

type Props = { status: EmailStatus; text?: string; title?: string };

// Small rounded status label; `text` replaces the label (e.g. a time).
export function StatusPill({ status, text, title }: Props) {
  const { className, label, icon: Icon } = STYLES[status];
  return (
    <span
      title={title}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${className}`}
    >
      <Icon className={`size-3 ${status === 'sending' ? 'animate-spin' : ''}`} aria-hidden="true" />
      {text ?? label}
    </span>
  );
}

export function statusLabel(status: EmailStatus): string {
  return STYLES[status].label;
}
