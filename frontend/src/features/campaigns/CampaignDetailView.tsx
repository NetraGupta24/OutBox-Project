'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { AlertCircle, ArrowLeft, Ban, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { useApi } from '@/hooks/useApi';
import { api, ApiError } from '@/lib/api';
import { formatDuration, formatFull, formatRelative, plural } from '@/lib/format';
import type { CampaignDetail } from '@/types/api';
import { EmailListView } from '@/features/emails/EmailListView';
import { ProgressBar, ProgressLegend, StateBadge, pendingCount } from './progress';

function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="min-w-0" title={hint}>
      <dt className="text-[11px] font-medium tracking-wider text-ink-muted uppercase">{label}</dt>
      <dd className="mt-0.5 truncate text-[13px] text-ink">{value}</dd>
    </div>
  );
}

function Actions({ campaign, onDone }: { campaign: CampaignDetail; onDone: () => void }) {
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<'cancel' | 'retry' | null>(null);
  // Emails already being handed to SMTP can't be stopped.
  const cancellable = campaign.counts.scheduled + campaign.counts.delayed;
  const failed = campaign.counts.failed;

  async function run(action: 'cancel' | 'retry') {
    setBusy(action);
    try {
      const result = await api<{ cancelled?: number; retried?: number }>(
        `/api/campaigns/${campaign.id}/${action}`,
        { method: 'POST' },
      );
      toast(
        action === 'cancel'
          ? { tone: 'info', title: `Cancelled ${plural(result.cancelled ?? 0, 'email')}` }
          : {
              tone: 'success',
              title: `Retrying ${plural(result.retried ?? 0, 'email')}`,
              description: 'They go out again now, within the sending limits.',
            },
      );
      onDone();
    } catch (err) {
      toast({ tone: 'error', title: (err as ApiError).message });
    } finally {
      setBusy(null);
      setConfirming(false);
    }
  }

  if (confirming) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-800">
        <span>Cancel {plural(cancellable, 'unsent email')}? This can&apos;t be undone.</span>
        <Button
          variant="danger"
          size="sm"
          loading={busy === 'cancel'}
          onClick={() => void run('cancel')}
        >
          Cancel emails
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
          Keep sending
        </Button>
      </div>
    );
  }

  if (cancellable === 0 && failed === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {failed > 0 && (
        <Button
          variant="outline"
          size="sm"
          pill
          icon={<RotateCcw className="size-3.5" />}
          loading={busy === 'retry'}
          onClick={() => void run('retry')}
        >
          Retry {plural(failed, 'failed email')}
        </Button>
      )}
      {cancellable > 0 && (
        <Button
          variant="ghost"
          size="sm"
          pill
          className="text-red-700 hover:bg-red-50"
          icon={<Ban className="size-3.5" />}
          onClick={() => setConfirming(true)}
        >
          Cancel remaining
        </Button>
      )}
    </div>
  );
}

export function CampaignDetailView({ id }: { id: number }) {
  // Refresh while emails are still going out.
  const [live, setLive] = useState(true);
  const [actions, setActions] = useState(0);
  const { data, error, loading, reload } = useApi<CampaignDetail>(`/api/campaigns/${id}`, {
    refreshMs: live ? 3000 : undefined,
  });
  const isLive = !data || pendingCount(data) > 0;
  if (!error && isLive !== live) setLive(isLive);

  if (loading && !data) {
    return (
      <div className="space-y-4 px-6 py-6">
        <Skeleton className="h-6 w-72" />
        <Skeleton className="h-2.5 w-full rounded-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }
  if (error && !data) {
    return (
      <EmptyState
        icon={<AlertCircle className="size-5" />}
        title={error.status === 404 ? 'Campaign not found' : "Couldn't load this campaign"}
        description={error.status === 404 ? undefined : error.message}
        action={
          <Link href="/campaigns" className="text-sm font-medium text-brand-600 hover:underline">
            Back to Campaigns
          </Link>
        }
      />
    );
  }
  if (!data) return null;

  const pending = pendingCount(data);
  const done = data.counts.sent + data.counts.failed + data.counts.cancelled;

  return (
    <div className="flex h-full flex-col">
      <section className="border-b border-border px-4 py-5 sm:px-6">
        <Link
          href="/campaigns"
          className="mb-3 inline-flex items-center gap-1 text-xs text-ink-muted hover:text-ink"
        >
          <ArrowLeft className="size-3.5" /> Campaigns
        </Link>
        <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
          <h1 className="min-w-0 flex-1 text-lg font-semibold break-words text-ink">
            {data.subject}
          </h1>
          <StateBadge campaign={data} />
        </div>

        <div className="mt-4 flex items-center gap-3">
          <ProgressBar campaign={data} size="md" />
          <span className="shrink-0 text-sm font-medium text-ink tabular-nums">
            {done.toLocaleString()} / {data.total.toLocaleString()}
          </span>
        </div>
        <div className="mt-2">
          <ProgressLegend campaign={data} />
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
          <Stat label="From" value={data.senderEmail} />
          <Stat
            label="Start"
            value={formatRelative(data.startAt)}
            hint={formatFull(data.startAt)}
          />
          <Stat label="Delay" value={`${formatDuration(data.delayMs)} between emails`} />
          <Stat label="Hourly limit" value={plural(data.hourlyLimit, 'email')} />
          {pending > 0 && data.finishAt ? (
            <Stat
              label="Last email"
              value={formatRelative(data.finishAt)}
              hint={`Projected: ${formatFull(data.finishAt)}`}
            />
          ) : data.lastSentAt ? (
            <Stat
              label="Finished"
              value={formatRelative(data.lastSentAt)}
              hint={formatFull(data.lastSentAt)}
            />
          ) : (
            <Stat label="Finished" value="—" />
          )}
        </dl>

        <div className="mt-5">
          <Actions
            campaign={data}
            onDone={() => {
              void reload();
              setActions((n) => n + 1);
            }}
          />
        </div>
      </section>

      <EmailListView tab="all" campaignId={data.id} reloadKey={actions} />
    </div>
  );
}
