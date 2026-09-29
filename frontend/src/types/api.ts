// Shapes returned by the backend API.

export type User = {
  id: number;
  email: string;
  name: string;
  avatarUrl: string | null;
};

export type EmailStatus = 'scheduled' | 'delayed' | 'sending' | 'sent' | 'failed';
export type EmailTab = 'scheduled' | 'sent';

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
  previewUrl: string | null;
  error: string | null;
};

export type Paginated<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  searchedWith?: 'elasticsearch' | 'database';
};

export type EmailCounts = {
  scheduled: number;
  sent: number;
  failed: number;
  delayed: number;
};

export type EmailDetail = {
  id: number;
  campaignId: number;
  recipient: string;
  subject: string;
  bodyHtml: string;
  bodyText: string;
  sender: { email: string; displayName: string };
  status: EmailStatus;
  attempts: number;
  scheduledAt: string;
  sentAt: string | null;
  messageId: string | null;
  previewUrl: string | null;
  error: string | null;
};

export type Sender = {
  id: number;
  email: string;
  displayName: string;
  hourlyLimit: number;
  usage: { used: number; windowStart: string; windowEnd: string } | null;
};

export type CampaignInput = {
  senderId: number;
  subject: string;
  bodyHtml: string;
  bodyText: string;
  recipients: string[];
  startAt?: string;
  delayMs: number;
  hourlyLimit: number;
};

export type CampaignPreview = {
  count: number;
  startAt: string;
  finishAt: string | null;
  hourWindows: number;
  effectiveDelayMs: number;
  effectiveHourlyLimit: number;
  windowMs: number; // rate-limit window: an hour unless shortened for a demo
};

export type CreateCampaignResult = {
  campaign: {
    id: number;
    total: number;
    startAt: string;
    projectedFinishAt: string | null;
  };
  duplicatesRemoved: number;
  replayed: boolean;
};

export type ApiErrorBody = {
  error: string;
  details?: unknown;
};

export type SlackStatus = {
  configured: boolean;
  connected: boolean;
  teamName: string | null;
  channel: string | null;
  connectedAt: string | null;
  disconnectedBySlack: boolean;
};
