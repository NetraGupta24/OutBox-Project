'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { AlertCircle, ChevronLeft, ChevronRight, LayoutList, RefreshCw } from 'lucide-react';
import { Button, IconButton } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { useApi } from '@/hooks/useApi';
import { formatFull, formatRelative, plural } from '@/lib/format';
import type { CampaignListItem, Paginated } from '@/types/api';
import { ProgressBar, StateBadge, pendingCount } from './progress';

const PAGE_SIZE = 20;
const REFRESH_MS = 5000;

function When({ campaign }: { campaign: CampaignListItem }) {
  const pending = pendingCount(campaign);
  if (pending > 0 && campaign.finishAt) {
    return (
      <span title={formatFull(campaign.finishAt)}>
        {pending.toLocaleString()} to go · last one {formatRelative(campaign.finishAt)}
      </span>
    );
  }
  if (campaign.lastSentAt) {
    return (
      <span title={formatFull(campaign.lastSentAt)}>
        Finished {formatRelative(campaign.lastSentAt)}
      </span>
    );
  }
  return (
    <span title={formatFull(campaign.createdAt)}>Created {formatRelative(campaign.createdAt)}</span>
  );
}

function CampaignRow({ campaign }: { campaign: CampaignListItem }) {
  const done = campaign.counts.sent + campaign.counts.failed + campaign.counts.cancelled;
  const percent = Math.round((done / Math.max(campaign.total, 1)) * 100);
  return (
    <li>
      <Link
        href={`/campaigns/${campaign.id}`}
        className="block border-b border-border px-4 py-4 transition-colors hover:bg-muted/70 focus-visible:bg-muted focus-visible:outline-none sm:px-6"
      >
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
            {campaign.subject}
          </span>
          <StateBadge campaign={campaign} />
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-ink-muted">
          <span className="truncate">From {campaign.senderEmail}</span>
          <span>{plural(campaign.total, 'recipient')}</span>
          <When campaign={campaign} />
        </div>
        <div className="mt-3 flex items-center gap-3">
          <ProgressBar campaign={campaign} />
          <span className="w-24 shrink-0 text-right text-xs text-ink-muted tabular-nums">
            {percent}% done
          </span>
        </div>
      </Link>
    </li>
  );
}

export function CampaignListView() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const page = Math.max(1, Number(params.get('page')) || 1);

  const { data, error, loading, refreshing, reload } = useApi<Paginated<CampaignListItem>>(
    `/api/campaigns?page=${page}&pageSize=${PAGE_SIZE}`,
    { refreshMs: REFRESH_MS },
  );

  const goTo = (next: number) =>
    router.replace(next > 1 ? `${pathname}?page=${next}` : pathname, { scroll: false });

  return (
    <div className="flex h-full flex-col">
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-surface/95 px-4 py-3 backdrop-blur sm:px-6">
        <h1 className="flex-1 text-[15px] font-semibold text-ink">Campaigns</h1>
        <IconButton label="Refresh" onClick={() => void reload()}>
          <RefreshCw className={`size-4 ${refreshing ? 'animate-spin' : ''}`} />
        </IconButton>
      </div>

      <div className="flex-1">
        {loading && !data ? (
          <ul aria-busy="true" aria-label="Loading campaigns">
            {Array.from({ length: 5 }, (_, i) => (
              <li key={i} className="space-y-3 border-b border-border px-6 py-4">
                <Skeleton className="h-4 w-64" />
                <Skeleton className="h-3 w-80" />
                <Skeleton className="h-1.5 w-full rounded-full" />
              </li>
            ))}
          </ul>
        ) : error && !data ? (
          <EmptyState
            icon={<AlertCircle className="size-5" />}
            title="Couldn't load campaigns"
            description={error.message}
            action={
              <Button variant="outline" onClick={() => void reload()}>
                Try again
              </Button>
            }
          />
        ) : data && data.items.length === 0 ? (
          <EmptyState
            icon={<LayoutList className="size-5" />}
            title="No campaigns yet"
            description="Each time you schedule emails from Compose, the batch shows up here with its live progress."
            action={
              <Link
                href="/compose"
                className="inline-flex h-9 items-center rounded-full bg-brand-500 px-4 text-sm font-medium text-white hover:bg-brand-600"
              >
                Compose new email
              </Link>
            }
          />
        ) : data ? (
          <ul aria-label="Campaigns">
            {data.items.map((campaign) => (
              <CampaignRow key={campaign.id} campaign={campaign} />
            ))}
          </ul>
        ) : null}
      </div>

      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-end gap-1 border-t border-border px-4 py-2 text-xs text-ink-muted sm:px-6">
          <IconButton label="Previous page" disabled={page <= 1} onClick={() => goTo(page - 1)}>
            <ChevronLeft className="size-4" />
          </IconButton>
          <span>
            Page {data.page} of {data.totalPages}
          </span>
          <IconButton
            label="Next page"
            disabled={page >= data.totalPages}
            onClick={() => goTo(page + 1)}
          >
            <ChevronRight className="size-4" />
          </IconButton>
        </div>
      )}
    </div>
  );
}
