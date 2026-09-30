import type { EmailStatus } from '../../generated/prisma/client.js';
import { prisma } from '../../lib/prisma.js';
import { notFound } from '../../lib/httpError.js';
import type { Paginated } from '../emails/email.service.js';

const STATUSES: EmailStatus[] = ['scheduled', 'delayed', 'sending', 'sent', 'failed', 'cancelled'];
const PENDING: EmailStatus[] = ['scheduled', 'delayed', 'sending'];

export type CampaignCounts = Record<EmailStatus, number>;

export type CampaignListItem = {
  id: number;
  subject: string;
  senderEmail: string;
  total: number;
  counts: CampaignCounts;
  createdAt: string;
  startAt: string;
  delayMs: number;
  hourlyLimit: number;
  nextSendAt: string | null; // earliest email still to go
  finishAt: string | null; // latest email still to go: the projected finish
  firstSentAt: string | null;
  lastSentAt: string | null;
};

export type CampaignDetail = CampaignListItem & { bodyHtml: string };

const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;

type CampaignRow = {
  id: number;
  subject: string;
  total: number;
  createdAt: Date;
  startAt: Date;
  delayMs: number;
  hourlyLimit: number;
  sender: { email: string };
};

// Adds live progress (counts per status, next and last send) to campaigns,
// with three grouped queries however many campaigns there are.
async function withProgress(campaigns: CampaignRow[]): Promise<CampaignListItem[]> {
  const ids = campaigns.map((c) => c.id);
  if (ids.length === 0) return [];
  const [byStatus, pending, sent] = await Promise.all([
    prisma.email.groupBy({
      by: ['campaignId', 'status'],
      where: { campaignId: { in: ids } },
      _count: { _all: true },
    }),
    prisma.email.groupBy({
      by: ['campaignId'],
      where: { campaignId: { in: ids }, status: { in: PENDING } },
      _min: { scheduledAt: true },
      _max: { scheduledAt: true },
    }),
    prisma.email.groupBy({
      by: ['campaignId'],
      where: { campaignId: { in: ids }, status: 'sent' },
      _min: { sentAt: true },
      _max: { sentAt: true },
    }),
  ]);

  return campaigns.map((c) => {
    const counts = Object.fromEntries(STATUSES.map((s) => [s, 0])) as CampaignCounts;
    for (const g of byStatus) if (g.campaignId === c.id) counts[g.status] = g._count._all;
    const p = pending.find((g) => g.campaignId === c.id);
    const s = sent.find((g) => g.campaignId === c.id);
    return {
      id: c.id,
      subject: c.subject,
      senderEmail: c.sender.email,
      total: c.total,
      counts,
      createdAt: c.createdAt.toISOString(),
      startAt: c.startAt.toISOString(),
      delayMs: c.delayMs,
      hourlyLimit: c.hourlyLimit,
      nextSendAt: iso(p?._min.scheduledAt),
      finishAt: iso(p?._max.scheduledAt),
      firstSentAt: iso(s?._min.sentAt),
      lastSentAt: iso(s?._max.sentAt),
    };
  });
}

const campaignSelect = {
  id: true,
  subject: true,
  total: true,
  createdAt: true,
  startAt: true,
  delayMs: true,
  hourlyLimit: true,
  sender: { select: { email: true } },
} as const;

export async function listCampaigns(
  userId: number,
  { page, pageSize }: { page: number; pageSize: number },
): Promise<Paginated<CampaignListItem>> {
  const [rows, total] = await Promise.all([
    prisma.campaign.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: campaignSelect,
    }),
    prisma.campaign.count({ where: { userId } }),
  ]);
  return {
    items: await withProgress(rows),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getCampaign(userId: number, campaignId: number): Promise<CampaignDetail> {
  const row = await prisma.campaign.findFirst({
    where: { id: campaignId, userId },
    select: { ...campaignSelect, bodyHtml: true },
  });
  if (!row) throw notFound('Campaign not found');
  const [item] = await withProgress([row]);
  return { ...item!, bodyHtml: row.bodyHtml };
}
