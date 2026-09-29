import { Router } from 'express';
import { parseOrThrow } from '../../lib/validate.js';
import { currentUser } from '../auth/requireAuth.js';
import {
  campaignInputSchema,
  idempotencyKeySchema,
  previewInputSchema,
} from './campaign.schema.js';
import { createCampaign, previewCampaign } from './campaign.service.js';

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
