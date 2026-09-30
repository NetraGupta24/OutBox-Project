'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  ArrowLeft,
  Ban,
  CheckCircle2,
  Clock,
  ExternalLink,
  Hourglass,
  LayoutList,
  Loader2,
  RotateCcw,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button, IconButton } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusPill } from '@/components/ui/StatusPill';
import { useToast } from '@/components/ui/Toast';
import { useApi } from '@/hooks/useApi';
import { api, type ApiError } from '@/lib/api';
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

const FINISHED = ['sent', 'failed', 'cancelled'];

// Cancel an email that hasn't gone out yet, or send a failed one again.
function EmailActions({ email, onDone }: { email: EmailDetail; onDone: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const action =
    email.status === 'scheduled' || email.status === 'delayed'
      ? 'cancel'
      : email.status === 'failed'
        ? 'retry'
        : null;
  if (!action) return null;

  async function run() {
    setBusy(true);
    try {
      await api(`/api/emails/${email.id}/${action}`, { method: 'POST' });
      toast(
        action === 'cancel'
          ? { tone: 'info', title: 'Email cancelled' }
          : { tone: 'success', title: 'Sending again', description: 'It goes out shortly.' },
      );
      onDone();
    } catch (err) {
      toast({ tone: 'error', title: (err as ApiError).message });
    } finally {
      setBusy(false);
    }
  }

  return action === 'cancel' ? (
    <Button
      variant="ghost"
      size="sm"
      className="mt-4 w-full text-red-700 hover:bg-red-50"
      icon={<Ban className="size-3.5" />}
      loading={busy}
      onClick={() => void run()}
    >
      Cancel this email
    </Button>
  ) : (
    <Button
      variant="outline"
      size="sm"
      className="mt-4 w-full"
      icon={<RotateCcw className="size-3.5" />}
      loading={busy}
      onClick={() => void run()}
    >
      Retry sending
    </Button>
  );
}

function DeliveryCard({ email, onChange }: { email: EmailDetail; onChange: () => void }) {
  const done = FINISHED.includes(email.status);
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
        {email.status === 'cancelled' && (
          <Step
            icon={<Ban className="size-4" />}
            title="Cancelled"
            detail="Stopped before it was sent."
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
      <EmailActions email={email} onDone={onChange} />
      <Link
        href={`/campaigns/${email.campaignId}`}
        className="mt-4 flex items-center gap-1.5 border-t border-border pt-3 text-[13px] text-ink-muted hover:text-ink"
      >
        <LayoutList className="size-3.5" /> View campaign progress
      </Link>
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
  const isFinal = error?.status === 404 || (email !== undefined && FINISHED.includes(email.status));
  if (isFinal !== final) setFinal(isFinal);
  const backHref = email && FINISHED.includes(email.status) ? '/sent' : '/scheduled';

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
              <DeliveryCard email={email} onChange={() => void reload()} />
            </aside>
          </div>
        ) : null}
      </main>
    </>
  );
}
