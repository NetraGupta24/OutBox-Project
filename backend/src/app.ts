import express, { type NextFunction, type Request, type Response } from 'express';
import { redis } from './lib/redis.js';
import { es } from './lib/elasticsearch.js';
import { prisma } from './lib/prisma.js';
import { HttpError } from './lib/httpError.js';
import { withTimeout } from './lib/async.js';
import { env } from './config/env.js';
import { requireAuth } from './modules/auth/requireAuth.js';
import { BULL_BOARD_PATH, basicAuth, bullBoardRouter } from './modules/admin/bullBoard.js';
import { campaignRouter } from './modules/campaigns/campaign.routes.js';
import { emailRouter } from './modules/emails/email.routes.js';
import { senderRouter } from './modules/senders/sender.routes.js';

const HEALTH_CHECK_TIMEOUT_MS = 2_000;

// Each dependency gets a short time limit so /health always answers quickly.
async function check(fn: () => Promise<unknown>): Promise<'up' | 'down'> {
  try {
    await withTimeout(fn(), HEALTH_CHECK_TIMEOUT_MS, 'timeout');
    return 'up';
  } catch {
    return 'down';
  }
}

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.get('/health', async (_req, res) => {
    const [mysqlStatus, redisStatus, esStatus] = await Promise.all([
      check(() => prisma.$queryRaw`SELECT 1`),
      check(() => redis.ping()),
      check(() => es.ping()),
    ]);
    const ok = mysqlStatus === 'up' && redisStatus === 'up' && esStatus === 'up';
    res.status(ok ? 200 : 503).json({
      status: ok ? 'ok' : 'degraded',
      services: { mysql: mysqlStatus, redis: redisStatus, elasticsearch: esStatus },
      uptime: Math.round(process.uptime()),
    });
  });

  if (env.BULL_BOARD_PASSWORD) {
    app.use(
      BULL_BOARD_PATH,
      basicAuth(env.BULL_BOARD_USERNAME, env.BULL_BOARD_PASSWORD),
      bullBoardRouter(),
    );
  } else {
    console.warn(`Queue dashboard disabled: set BULL_BOARD_PASSWORD to enable ${BULL_BOARD_PATH}`);
  }

  app.use('/api', requireAuth);
  app.use('/api/campaigns', campaignRouter);
  app.use('/api/emails', emailRouter);
  app.use('/api/senders', senderRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message, details: err.details });
      return;
    }
    // Errors raised by express.json(), e.g. malformed JSON or a body over the limit.
    const status = (err as { status?: number }).status;
    if (status && status >= 400 && status < 500) {
      res.status(status).json({ error: err.message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
