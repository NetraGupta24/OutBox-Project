import { Router } from 'express';
import { z } from 'zod';
import { parseOrThrow } from '../../lib/validate.js';
import { currentUser } from '../auth/requireAuth.js';
import { countEmails, getEmail, listEmails } from './email.service.js';

const listQuerySchema = z.object({
  // Which tab. `filter` narrows it to one status, e.g. tab=sent&filter=failed.
  status: z.enum(['scheduled', 'sent']).default('scheduled'),
  filter: z.enum(['scheduled', 'delayed', 'sending', 'sent', 'failed']).optional(),
  q: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => v || undefined),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

const idParamSchema = z.object({ id: z.coerce.number().int().positive() });

export const emailRouter = Router();

emailRouter.get('/', async (req, res) => {
  const query = parseOrThrow(listQuerySchema, req.query);
  res.json(
    await listEmails(currentUser(req).id, {
      tab: query.status,
      status: query.filter,
      q: query.q,
      page: query.page,
      pageSize: query.pageSize,
    }),
  );
});

emailRouter.get('/counts', async (req, res) => {
  res.json(await countEmails(currentUser(req).id));
});

emailRouter.get('/:id', async (req, res) => {
  const { id } = parseOrThrow(idParamSchema, req.params);
  res.json(await getEmail(currentUser(req).id, id));
});
