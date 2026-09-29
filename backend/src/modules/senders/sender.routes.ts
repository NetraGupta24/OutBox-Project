import { Router } from 'express';
import { currentUser } from '../auth/requireAuth.js';
import { listSenders } from './sender.service.js';

export const senderRouter = Router();

senderRouter.get('/', async (req, res) => {
  res.json({ items: await listSenders(currentUser(req).id) });
});
