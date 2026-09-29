import { z } from 'zod';
import { env } from '../../config/env.js';

export const campaignInputSchema = z.object({
  senderId: z.number().int().positive(),
  subject: z.string().trim().min(1).max(255),
  bodyHtml: z.string().min(1).max(500_000),
  bodyText: z.string().max(200_000).optional(),
  recipients: z.array(z.string().max(320)).min(1).max(env.MAX_RECIPIENTS_PER_CAMPAIGN),
  // ISO 8601 with offset, e.g. 2026-10-01T10:00:00.000Z. Omitted or past = now.
  startAt: z.iso.datetime({ offset: true }).optional(),
  delayMs: z
    .number()
    .int()
    .min(0)
    .max(24 * 3_600_000),
  hourlyLimit: z.number().int().min(1).max(100_000),
});

export type CampaignInput = z.infer<typeof campaignInputSchema>;

export const previewInputSchema = campaignInputSchema
  .pick({ senderId: true, startAt: true, delayMs: true, hourlyLimit: true })
  .extend({ count: z.number().int().min(1).max(env.MAX_RECIPIENTS_PER_CAMPAIGN) });

export const idempotencyKeySchema = z
  .string()
  .trim()
  .min(8)
  .max(100)
  .regex(/^[A-Za-z0-9_-]+$/, 'letters, digits, "-" and "_" only');
