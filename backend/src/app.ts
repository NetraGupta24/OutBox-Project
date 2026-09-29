import express, { type NextFunction, type Request, type Response } from 'express';
import { redis } from './lib/redis.js';
import { es } from './lib/elasticsearch.js';
import { prisma } from './lib/prisma.js';

async function check(fn: () => Promise<unknown>): Promise<'up' | 'down'> {
  try {
    await fn();
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

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
