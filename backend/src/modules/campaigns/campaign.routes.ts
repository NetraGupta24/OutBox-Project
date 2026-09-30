import { Router } from 'express';
import { z } from 'zod';
import { parseOrThrow } from '../../lib/validate.js';
import { currentUser } from '../auth/requireAuth.js';
import {
  campaignInputSchema,
  idempotencyKeySchema,
  previewInputSchema,
} from './campaign.schema.js';
import { createCampaign, previewCampaign } from './campaign.service.js';
import { getCampaign, listCampaigns } from './campaign.query.js';
import { cancelEmails, retryEmails } from '../emails/email.actions.js';

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
const idParamSchema = z.object({ id: z.coerce.number().int().positive() });

export const campaignRouter = Router();

// Schedules one email per recipient. Send an Idempotency-Key header so a
// retried or double-submitted request returns the original campaign.
campaignRouter.post('/', async (req, res) => {
  const input = parseOrThrow(campaignInputSchema, req.body);
  const rawKey = req.header('idempotency-key');
  const key = rawKey === undefined ? undefined : parseOrThrow(idempotencyKeySchema, rawKey);

  const result = await createCampaign(currentUser(req).id, input, key);
  res.status(result.replayed ? 200 : 201).json(result);
});

// Projected send window for the Compose screen; nothing is saved.
campaignRouter.post('/preview', async (req, res) => {
  const input = parseOrThrow(previewInputSchema, req.body);
  res.json(await previewCampaign(currentUser(req).id, input));
});

// Campaigns with live progress, newest first.
campaignRouter.get('/', async (req, res) => {
  const query = parseOrThrow(listQuerySchema, req.query);
  res.json(await listCampaigns(currentUser(req).id, query));
});

campaignRouter.get('/:id', async (req, res) => {
  const { id } = parseOrThrow(idParamSchema, req.params);
  res.json(await getCampaign(currentUser(req).id, id));
});

// Cancels every email of the campaign that hasn't started sending.
campaignRouter.post('/:id/cancel', async (req, res) => {
  const { id } = parseOrThrow(idParamSchema, req.params);
  res.json(await cancelEmails({ userId: currentUser(req).id, campaignId: id }));
});

// Sends the campaign's failed emails again.
campaignRouter.post('/:id/retry', async (req, res) => {
  const { id } = parseOrThrow(idParamSchema, req.params);
  res.json(await retryEmails({ userId: currentUser(req).id, campaignId: id }));
});
