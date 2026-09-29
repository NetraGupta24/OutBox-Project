import type { EmailStatus, Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../lib/prisma.js';
import { notFound } from '../../lib/httpError.js';

// Dashboard tabs map to groups of row statuses.
export const TAB_STATUSES = {
  scheduled: ['scheduled', 'delayed', 'sending'],
  sent: ['sent', 'failed'],
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
};

export type ListOptions = {
  tab: EmailTab;
  page: number;
  pageSize: number;
  // Narrow the tab to one status, e.g. only failed emails in Sent.
  status?: EmailStatus;
  // Matches recipient or subject (case-insensitive substring).
  q?: string;
};

function preview(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > PREVIEW_LENGTH ? `${flat.slice(0, PREVIEW_LENGTH)}…` : flat;
}

export async function listEmails(
  userId: number,
  { tab, page, pageSize, status, q }: ListOptions,
): Promise<Paginated<EmailListItem>> {
  const allowed: readonly EmailStatus[] = TAB_STATUSES[tab];
  const statuses = status && allowed.includes(status) ? [status] : [...allowed];
  const where: Prisma.EmailWhereInput = {
    userId,
    status: { in: statuses },
    ...(q ? { OR: [{ recipient: { contains: q } }, { subject: { contains: q } }] } : {}),
  };
  // Scheduled: soonest first. Sent: most recent first.
  const orderBy: Prisma.EmailOrderByWithRelationInput[] =
    tab === 'scheduled'
      ? [{ scheduledAt: 'asc' }, { id: 'asc' }]
      : [{ updatedAt: 'desc' }, { id: 'desc' }];

  const [rows, total] = await Promise.all([
    prisma.email.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        campaign: { select: { bodyText: true } },
        sender: { select: { email: true } },
      },
    }),
    prisma.email.count({ where }),
  ]);

  return {
    items: rows.map((row) => ({
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
    })),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export type EmailCounts = Record<EmailTab, number> & { failed: number; delayed: number };

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
