import { Router } from 'express';
import { z } from 'zod';
import { parseOrThrow } from '../../lib/validate.js';
import { currentUser } from '../auth/requireAuth.js';
import { countEmails, getEmail, listEmails } from './email.service.js';

const listQuerySchema = z.object({
  status: z.enum(['scheduled', 'sent']).default('scheduled'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

const idParamSchema = z.object({ id: z.coerce.number().int().positive() });

export const emailRouter = Router();

emailRouter.get('/', async (req, res) => {
  const query = parseOrThrow(listQuerySchema, req.query);
  res.json(await listEmails(currentUser(req).id, query.status, query.page, query.pageSize));
});

emailRouter.get('/counts', async (req, res) => {
  res.json(await countEmails(currentUser(req).id));
});

emailRouter.get('/:id', async (req, res) => {
  const { id } = parseOrThrow(idParamSchema, req.params);
  res.json(await getEmail(currentUser(req).id, id));
});
