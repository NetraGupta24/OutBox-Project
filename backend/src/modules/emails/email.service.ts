import type { EmailStatus } from '../../generated/prisma/client.js';
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
};

export type Paginated<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

function preview(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > PREVIEW_LENGTH ? `${flat.slice(0, PREVIEW_LENGTH)}…` : flat;
}

export async function listEmails(
  userId: number,
  tab: EmailTab,
  page: number,
  pageSize: number,
): Promise<Paginated<EmailListItem>> {
  const where = { userId, status: { in: [...TAB_STATUSES[tab]] } };
  // Scheduled: soonest first. Sent: most recent first.
  const orderBy =
    tab === 'scheduled'
      ? [{ scheduledAt: 'asc' as const }, { id: 'asc' as const }]
      : [{ updatedAt: 'desc' as const }, { id: 'desc' as const }];

  const [rows, total] = await Promise.all([
    prisma.email.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { campaign: { select: { bodyText: true } } },
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
    })),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function countEmails(userId: number): Promise<Record<EmailTab, number>> {
  const groups = await prisma.email.groupBy({
    by: ['status'],
    where: { userId },
    _count: { _all: true },
  });
  const count = (statuses: readonly EmailStatus[]) =>
    groups.filter((g) => statuses.includes(g.status)).reduce((sum, g) => sum + g._count._all, 0);
  return { scheduled: count(TAB_STATUSES.scheduled), sent: count(TAB_STATUSES.sent) };
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
    previewUrl: email.previewUrl,
    error: email.error,
  };
}
