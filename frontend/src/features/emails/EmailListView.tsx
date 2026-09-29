'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Clock,
  RefreshCw,
  Search,
  SearchX,
  Send,
  X,
} from 'lucide-react';
import { Button, IconButton } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { useApi } from '@/hooks/useApi';
import type { EmailListItem, EmailStatus, EmailTab, Paginated } from '@/types/api';
import { EmailRow } from './EmailRow';

const PAGE_SIZE = 25;
const REFRESH_MS = 5000;

const FILTERS: Record<EmailTab, { value: EmailStatus | 'all'; label: string }[]> = {
  scheduled: [
    { value: 'all', label: 'All' },
    { value: 'scheduled', label: 'Scheduled' },
    { value: 'delayed', label: 'Delayed' },
  ],
  sent: [
    { value: 'all', label: 'All' },
    { value: 'sent', label: 'Sent' },
    { value: 'failed', label: 'Failed' },
  ],
};

export function EmailListView({ tab }: { tab: EmailTab }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  // Search, filter and page live in the URL, so links and Back keep them.
  const q = params.get('q') ?? '';
  const filter = params.get('filter') ?? 'all';
  const page = Math.max(1, Number(params.get('page')) || 1);

  // The search box follows the URL (e.g. Back), but stays editable.
  const [search, setSearch] = useState(q);
  const [syncedQ, setSyncedQ] = useState(q);
  if (q !== syncedQ) {
    setSyncedQ(q);
    setSearch(q);
  }

  function update(next: Record<string, string | number | null>) {
    const url = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) {
      if (value === null || value === '' || value === 'all' || (key === 'page' && value === 1))
        url.delete(key);
      else url.set(key, String(value));
    }
    const query = url.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  // Search as you type, after a short pause.
  useEffect(() => {
    if (search.trim() === q) return;
    const timer = setTimeout(() => update({ q: search.trim(), page: null }), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const apiParams = new URLSearchParams({
    status: tab,
    page: String(page),
    pageSize: String(PAGE_SIZE),
  });
  if (q) apiParams.set('q', q);
  if (filter !== 'all') apiParams.set('filter', filter);
  const { data, error, loading, refreshing, reload } = useApi<Paginated<EmailListItem>>(
    `/api/emails?${apiParams}`,
    { refreshMs: REFRESH_MS },
  );

  const filtered = q !== '' || filter !== 'all';
  const first = data && data.total > 0 ? (data.page - 1) * data.pageSize + 1 : 0;
  const last = data ? Math.min(data.page * data.pageSize, data.total) : 0;

  return (
    <div className="flex h-full flex-col">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-border bg-surface/95 px-4 py-3 backdrop-blur sm:px-6">
        <label className="relative flex min-w-0 basis-full items-center sm:max-w-md sm:flex-1 sm:basis-auto">
          <Search
            className="pointer-events-none absolute left-3 size-4 text-ink-muted"
            aria-hidden="true"
          />
          <input
            id="email-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by recipient or subject"
            aria-label="Search emails"
            className="h-9 w-full rounded-full bg-muted pr-9 pl-9 text-[13px] outline-none placeholder:text-ink-muted focus:ring-2 focus:ring-brand-500/40"
          />
          {search ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setSearch('')}
              className="absolute right-2 rounded-full p-1 text-ink-muted hover:bg-border hover:text-ink"
            >
              <X className="size-3.5" />
            </button>
          ) : (
            <kbd className="absolute right-3 hidden rounded border border-border px-1.5 text-[10px] text-ink-muted sm:block">
              /
            </kbd>
          )}
        </label>

        <div
          role="radiogroup"
          aria-label="Filter by status"
          className="flex rounded-full bg-muted p-0.5"
        >
          {FILTERS[tab].map((f) => (
            <button
              key={f.value}
              type="button"
              role="radio"
              aria-checked={filter === f.value}
              onClick={() => update({ filter: f.value, page: null })}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                filter === f.value
                  ? 'bg-surface text-ink shadow-sm'
                  : 'text-ink-muted hover:text-ink'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <IconButton label="Refresh" onClick={() => void reload()}>
          <RefreshCw className={`size-4 ${refreshing ? 'animate-spin' : ''}`} />
        </IconButton>
      </div>

      <div className="flex-1">
        {loading && !data ? (
          <ul aria-busy="true" aria-label="Loading emails">
            {Array.from({ length: 8 }, (_, i) => (
              <li key={i} className="flex items-center gap-4 border-b border-border px-6 py-3.5">
                <Skeleton className="h-3 w-40" />
                <Skeleton className="h-4 w-20 rounded-full" />
                <Skeleton className="h-3 flex-1" />
                <Skeleton className="h-3 w-16" />
              </li>
            ))}
          </ul>
        ) : error && !data ? (
          <EmptyState
            icon={<AlertCircle className="size-5" />}
            title="Couldn't load emails"
            description={error.message}
            action={
              <Button variant="outline" onClick={() => void reload()}>
                Try again
              </Button>
            }
          />
        ) : data && data.items.length === 0 ? (
          filtered ? (
            <EmptyState
              icon={<SearchX className="size-5" />}
              title="No matching emails"
              description="Try a different search or filter."
              action={
                <Button
                  variant="outline"
                  onClick={() => {
                    setSearch('');
                    update({ q: null, filter: null, page: null });
                  }}
                >
                  Clear filters
                </Button>
              }
            />
          ) : tab === 'scheduled' ? (
            <EmptyState
              icon={<Clock className="size-5" />}
              title="No scheduled emails"
              description="Emails you schedule show up here until they're sent."
              action={
                <Link
                  href="/compose"
                  className="inline-flex h-9 items-center rounded-full bg-brand-500 px-4 text-sm font-medium text-white hover:bg-brand-600"
                >
                  Compose new email
                </Link>
              }
            />
          ) : (
            <EmptyState
              icon={<Send className="size-5" />}
              title="No sent emails yet"
              description="Sent and failed emails appear here once they go out."
            />
          )
        ) : data ? (
          <ul
            aria-label={tab === 'scheduled' ? 'Scheduled emails' : 'Sent emails'}
            aria-busy={loading}
            className={`transition-opacity ${loading ? 'opacity-50' : ''}`}
          >
            {data.items.map((email) => (
              <EmailRow key={email.id} email={email} tab={tab} />
            ))}
          </ul>
        ) : null}
      </div>

      {data && data.total > 0 && (
        <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-2 text-xs text-ink-muted sm:px-6">
          <span>
            {first.toLocaleString()}–{last.toLocaleString()} of {data.total.toLocaleString()}
            {error && <span className="ml-2 text-red-600">· Refresh failed</span>}
          </span>
          <span className="flex items-center gap-1">
            <IconButton
              label="Previous page"
              disabled={page <= 1}
              onClick={() => update({ page: page - 1 })}
            >
              <ChevronLeft className="size-4" />
            </IconButton>
            <span>
              Page {data.page} of {data.totalPages}
            </span>
            <IconButton
              label="Next page"
              disabled={page >= data.totalPages}
              onClick={() => update({ page: page + 1 })}
            >
              <ChevronRight className="size-4" />
            </IconButton>
          </span>
        </div>
      )}
    </div>
  );
}
