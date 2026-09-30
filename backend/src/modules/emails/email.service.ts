import type { EmailStatus, Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../lib/prisma.js';
import { notFound } from '../../lib/httpError.js';
import { errorMessage } from '../../lib/errors.js';
import { searchEmailIds } from '../search/emailIndex.js';

// Dashboard tabs map to groups of row statuses.
export const TAB_STATUSES = {
  scheduled: ['scheduled', 'delayed', 'sending'],
  sent: ['sent', 'failed', 'cancelled'],
  all: ['scheduled', 'delayed', 'sending', 'sent', 'failed', 'cancelled'],
} as const satisfies Record<string, EmailStatus[]>;

export type EmailTab = keyof typeof TAB_STATUSES;

const PREVIEW_LENGTH = 140;

export type EmailListItem = {
  id: number;
  campaignId: number;
  recipient: string;
  subject: string;
  preview: string;
  status: EmailStatus;
  scheduledAt: string;
  sentAt: string | null;
  senderEmail: string;
  previewUrl: string | null; // Ethereal web inbox link, once sent
  error: string | null; // why it failed (or last retry reason)
};

export type Paginated<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  // Set for searches: which engine answered.
  searchedWith?: 'elasticsearch' | 'database';
};

export type ListOptions = {
  tab: EmailTab;
  page: number;
  pageSize: number;
  // Narrow the tab to one status, e.g. only failed emails in Sent.
  status?: EmailStatus;
  // Matches recipient or subject (case-insensitive substring).
  q?: string;
  // Only this campaign's emails.
  campaignId?: number;
};

function preview(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > PREVIEW_LENGTH ? `${flat.slice(0, PREVIEW_LENGTH)}…` : flat;
}

const listInclude = {
  campaign: { select: { bodyText: true } },
  sender: { select: { email: true } },
} as const;

type ListRow = Prisma.EmailGetPayload<{ include: typeof listInclude }>;

function toListItem(row: ListRow): EmailListItem {
  return {
    id: row.id,
    campaignId: row.campaignId,
    recipient: row.recipient,
    subject: row.subject,
    preview: preview(row.campaign.bodyText),
    status: row.status,
    scheduledAt: row.scheduledAt.toISOString(),
    sentAt: row.sentAt?.toISOString() ?? null,
    senderEmail: row.sender.email,
    previewUrl: row.previewUrl,
    error: row.error,
  };
}

function page<T>(items: T[], opts: ListOptions, total: number): Paginated<T> {
  return {
    items,
    page: opts.page,
    pageSize: opts.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / opts.pageSize)),
  };
}

function tabStatuses({ tab, status }: ListOptions): EmailStatus[] {
  const allowed: readonly EmailStatus[] = TAB_STATUSES[tab];
  return status && allowed.includes(status) ? [status] : [...allowed];
}

// Search with Elasticsearch; the rows themselves come from MySQL, in the
// order Elasticsearch ranked them.
async function searchWithElasticsearch(userId: number, opts: ListOptions & { q: string }) {
  const statuses = tabStatuses(opts);
  const { ids, total } = await searchEmailIds({
    userId,
    statuses,
    campaignId: opts.campaignId,
    q: opts.q,
    from: (opts.page - 1) * opts.pageSize,
    size: opts.pageSize,
    newestFirst: opts.tab === 'sent',
  });
  const rows = await prisma.email.findMany({
    where: { id: { in: ids }, userId, status: { in: statuses } },
    include: listInclude,
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  const items = ids.flatMap((id) => {
    const row = byId.get(id);
    return row ? [toListItem(row)] : [];
  });
  return { ...page(items, opts, total), searchedWith: 'elasticsearch' as const };
}

let warnedSearchFallback = false;

export async function listEmails(
  userId: number,
  opts: ListOptions,
): Promise<Paginated<EmailListItem>> {
  if (opts.q) {
    try {
      const result = await searchWithElasticsearch(userId, { ...opts, q: opts.q });
      warnedSearchFallback = false;
      return result;
    } catch (err) {
      // Search keeps working (more simply) while Elasticsearch is unavailable.
      if (!warnedSearchFallback) {
        console.warn(`Elasticsearch search failed, using MySQL instead: ${errorMessage(err)}`);
        warnedSearchFallback = true;
      }
    }
  }

  const where: Prisma.EmailWhereInput = {
    userId,
    status: { in: tabStatuses(opts) },
    ...(opts.campaignId ? { campaignId: opts.campaignId } : {}),
    ...(opts.q
      ? { OR: [{ recipient: { contains: opts.q } }, { subject: { contains: opts.q } }] }
      : {}),
  };
  // Scheduled: soonest first. Sent: most recent first. A campaign: send order.
  const orderBy: Prisma.EmailOrderByWithRelationInput[] =
    opts.tab === 'scheduled'
      ? [{ scheduledAt: 'asc' }, { id: 'asc' }]
      : opts.tab === 'sent'
        ? [{ updatedAt: 'desc' }, { id: 'desc' }]
        : [{ scheduledAt: 'asc' }, { id: 'asc' }];

  const [rows, total] = await Promise.all([
    prisma.email.findMany({
      where,
      orderBy,
      skip: (opts.page - 1) * opts.pageSize,
      take: opts.pageSize,
      include: listInclude,
    }),
    prisma.email.count({ where }),
  ]);
  return {
    ...page(rows.map(toListItem), opts, total),
    ...(opts.q ? { searchedWith: 'database' as const } : {}),
  };
}

export type EmailCounts = Record<'scheduled' | 'sent', number> & {
  failed: number;
  delayed: number;
  cancelled: number;
};

export async function countEmails(userId: number): Promise<EmailCounts> {
  const groups = await prisma.email.groupBy({
    by: ['status'],
    where: { userId },
    _count: { _all: true },
  });
  const count = (statuses: readonly EmailStatus[]) =>
    groups.filter((g) => statuses.includes(g.status)).reduce((sum, g) => sum + g._count._all, 0);
  return {
    scheduled: count(TAB_STATUSES.scheduled),
    sent: count(TAB_STATUSES.sent),
    failed: count(['failed']),
    delayed: count(['delayed']),
    cancelled: count(['cancelled']),
  };
}

export async function getEmail(userId: number, emailId: number) {
  const email = await prisma.email.findFirst({
    where: { id: emailId, userId },
    include: {
      campaign: { select: { bodyHtml: true, bodyText: true } },
      sender: { select: { email: true, displayName: true } },
    },
  });
  if (!email) throw notFound('Email not found');

  return {
    id: email.id,
    campaignId: email.campaignId,
    recipient: email.recipient,
    subject: email.subject,
    bodyHtml: email.campaign.bodyHtml,
    bodyText: email.campaign.bodyText,
    sender: email.sender,
    status: email.status,
    attempts: email.attempts,
    scheduledAt: email.scheduledAt.toISOString(),
    sentAt: email.sentAt?.toISOString() ?? null,
    messageId: email.messageId,
    previewUrl: email.previewUrl,
    error: email.error,
  };
}
