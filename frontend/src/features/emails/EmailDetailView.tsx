'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  ExternalLink,
  Hourglass,
  Loader2,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button, IconButton } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusPill } from '@/components/ui/StatusPill';
import { useApi } from '@/hooks/useApi';
import { formatFull, formatRelative, plural } from '@/lib/format';
import type { EmailDetail } from '@/types/api';
import { EmailBody } from './EmailBody';

function Step({
  icon,
  title,
  detail,
  tone = 'text-ink-muted',
}: {
  icon: ReactNode;
  title: string;
  detail?: ReactNode;
  tone?: string;
}) {
  return (
    <li className="flex gap-3">
      <span className={`mt-0.5 ${tone}`}>{icon}</span>
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-ink">{title}</p>
        {detail && <div className="text-xs break-words text-ink-muted">{detail}</div>}
      </div>
    </li>
  );
}

function DeliveryCard({ email }: { email: EmailDetail }) {
  const done = email.status === 'sent' || email.status === 'failed';
  return (
    <section aria-label="Delivery" className="rounded-xl border border-border p-4">
      <h2 className="mb-3 text-xs font-medium tracking-wider text-ink-muted uppercase">Delivery</h2>
      <ol className="space-y-3">
        <Step
          icon={<Clock className="size-4" />}
          title={done ? 'Scheduled for' : `Scheduled ${formatRelative(email.scheduledAt)}`}
          detail={formatFull(email.scheduledAt)}
        />
        {email.status === 'delayed' && (
          <Step
            icon={<Hourglass className="size-4" />}
            tone="text-amber-600"
            title="Waiting for the next window"
            detail="The sender's hourly limit was reached, so this email moved to the time above."
          />
        )}
        {email.status === 'sending' && (
          <Step
            icon={<Loader2 className="size-4 animate-spin" />}
            tone="text-sky-600"
            title="Sending now…"
          />
        )}
        {email.status === 'sent' && email.sentAt && (
          <Step
            icon={<CheckCircle2 className="size-4" />}
            tone="text-brand-600"
            title={`Sent ${formatRelative(email.sentAt)}`}
            detail={
              <>
                {formatFull(email.sentAt)}
                {email.attempts > 1 && ` · after ${plural(email.attempts, 'attempt')}`}
              </>
            }
          />
        )}
        {email.status === 'failed' && (
          <Step
            icon={<AlertCircle className="size-4" />}
            tone="text-red-600"
            title={`Failed after ${plural(Math.max(email.attempts, 1), 'attempt')}`}
            detail={email.error}
          />
        )}
        {!done && email.error && email.status !== 'delayed' && (
          <Step
            icon={<AlertCircle className="size-4" />}
            tone="text-amber-600"
            title="Last attempt failed, retrying"
            detail={email.error}
          />
        )}
      </ol>

      {email.previewUrl && (
        <a
          href={email.previewUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-brand-600 hover:underline"
        >
          View in Ethereal <ExternalLink className="size-3.5" />
        </a>
      )}
      {email.messageId && (
        <p className="mt-3 truncate font-mono text-[11px] text-ink-muted" title={email.messageId}>
          {email.messageId}
        </p>
      )}
    </section>
  );
}

export function EmailDetailView({ id }: { id: number }) {
  const router = useRouter();
  // Poll only while the outcome can still change.
  const [final, setFinal] = useState(false);
  const {
    data: email,
    error,
    loading,
    reload,
  } = useApi<EmailDetail>(`/api/emails/${id}`, { refreshMs: final ? undefined : 5000 });
  const isFinal = error?.status === 404 || email?.status === 'sent' || email?.status === 'failed';
  if (isFinal !== final) setFinal(isFinal);
  const backHref =
    email && (email.status === 'sent' || email.status === 'failed') ? '/sent' : '/scheduled';

  return (
    <>
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-surface/95 px-3 py-3 backdrop-blur sm:px-5">
        <IconButton
          label="Back"
          onClick={() => (window.history.length > 1 ? router.back() : router.push(backHref))}
        >
          <ArrowLeft className="size-4.5" />
        </IconButton>
        {email ? (
          <>
            <h1 className="min-w-0 flex-1 truncate text-lg text-ink">{email.subject}</h1>
            <StatusPill status={email.status} />
          </>
        ) : (
          <Skeleton className="h-5 w-64" />
        )}
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-8">
        {loading && !email ? (
          <div className="space-y-4">
            <Skeleton className="h-10 w-72" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : error && !email ? (
          <EmptyState
            icon={<AlertCircle className="size-5" />}
            title={error.status === 404 ? 'Email not found' : "Couldn't load this email"}
            description={
              error.status === 404
                ? 'It may belong to another account, or the link is wrong.'
                : error.message
            }
            action={
              error.status === 404 ? (
                <Link
                  href="/scheduled"
                  className="text-sm font-medium text-brand-600 hover:underline"
                >
                  Back to Scheduled
                </Link>
              ) : (
                <Button variant="outline" onClick={() => void reload()}>
                  Try again
                </Button>
              )
            }
          />
        ) : email ? (
          <div className="grid gap-8 lg:grid-cols-[1fr_16rem]">
            <article className="min-w-0">
              <div className="flex items-start gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-500 text-sm font-semibold text-white">
                  {email.sender.displayName.charAt(0).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">
                    <span className="font-semibold text-ink">{email.sender.displayName}</span>{' '}
                    <span className="text-xs text-ink-muted">&lt;{email.sender.email}&gt;</span>
                  </p>
                  <p className="truncate text-xs text-ink-muted">to {email.recipient}</p>
                </div>
                <time
                  dateTime={email.sentAt ?? email.scheduledAt}
                  className="shrink-0 text-xs text-ink-muted"
                >
                  {formatFull(email.sentAt ?? email.scheduledAt)}
                </time>
              </div>
              <div className="mt-6 sm:pl-12">
                <EmailBody html={email.bodyHtml} />
              </div>
            </article>
            <aside>
              <DeliveryCard email={email} />
            </aside>
          </div>
        ) : null}
      </main>
    </>
  );
}
