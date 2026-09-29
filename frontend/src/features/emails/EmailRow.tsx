import Link from 'next/link';
import { StatusPill } from '@/components/ui/StatusPill';
import { formatFull, formatRelative, formatShort } from '@/lib/format';
import type { EmailListItem, EmailTab } from '@/types/api';

function pill(email: EmailListItem) {
  switch (email.status) {
    case 'scheduled':
      return (
        <StatusPill
          status="scheduled"
          text={formatShort(email.scheduledAt, { seconds: true })}
          title={formatFull(email.scheduledAt)}
        />
      );
    case 'delayed':
      return (
        <StatusPill
          status="delayed"
          text={`Delayed · ${formatShort(email.scheduledAt, { seconds: true })}`}
          title={`Sending limit reached. Moved to ${formatFull(email.scheduledAt)}`}
        />
      );
    case 'failed':
      return <StatusPill status="failed" title={email.error ?? undefined} />;
    default:
      return <StatusPill status={email.status} />;
  }
}

export function EmailRow({ email, tab }: { email: EmailListItem; tab: EmailTab }) {
  const when = tab === 'sent' ? (email.sentAt ?? email.scheduledAt) : email.scheduledAt;
  return (
    <li>
      <Link
        href={`/emails/${email.id}`}
        className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 border-b border-border px-4 py-3 transition-colors hover:bg-muted/70 focus-visible:bg-muted focus-visible:outline-none sm:flex sm:px-6"
      >
        <span className="truncate text-[13px] text-ink sm:w-48 sm:shrink-0">
          <span className="text-ink-muted">To:</span> {email.recipient}
        </span>
        <time
          dateTime={when}
          title={formatFull(when)}
          className="text-xs whitespace-nowrap text-ink-muted sm:order-last sm:w-28 sm:text-right"
        >
          {formatRelative(when)}
        </time>
        <span className="col-span-2 flex min-w-0 items-center gap-2 sm:flex-1">
          {pill(email)}
          <span className="min-w-0 truncate text-[13px]">
            <span className="font-semibold text-ink">{email.subject}</span>
            {email.preview && <span className="text-ink-muted"> - {email.preview}</span>}
          </span>
        </span>
      </Link>
    </li>
  );
}
