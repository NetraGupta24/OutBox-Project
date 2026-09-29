import { timingSafeEqual } from 'node:crypto';
import type { RequestHandler, Router } from 'express';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { emailQueue, notificationQueue } from '../../queue/queues.js';

export const BULL_BOARD_PATH = '/admin/queues';

// HTTP Basic auth: works in any browser without a session, including for reviewers.
export function basicAuth(username: string, password: string): RequestHandler {
  const expected = Buffer.from(`${username}:${password}`);
  return (req, res, next) => {
    const [scheme, encoded] = (req.header('authorization') ?? '').split(' ');
    const given = scheme === 'Basic' && encoded ? Buffer.from(encoded, 'base64') : Buffer.alloc(0);
    if (given.length === expected.length && timingSafeEqual(given, expected)) return next();
    res
      .set('WWW-Authenticate', 'Basic realm="Queue dashboard"')
      .status(401)
      .send('Authentication required');
  };
}

export function bullBoardRouter(): Router {
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath(BULL_BOARD_PATH);
  createBullBoard({
    queues: [new BullMQAdapter(emailQueue), new BullMQAdapter(notificationQueue)],
    serverAdapter,
  });
  return serverAdapter.getRouter() as Router;
}
