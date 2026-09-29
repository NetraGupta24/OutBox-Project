import { env } from './config/env.js';
import { createApp } from './app.js';
import { redis } from './lib/redis.js';
import { prisma } from './lib/prisma.js';

const app = createApp();

const server = app.listen(env.PORT, () => {
  console.log(`API listening on http://localhost:${env.PORT}`);
});

function shutdown(signal: string) {
  console.log(`${signal} received, shutting down API`);
  server.close(async () => {
    await Promise.allSettled([redis.quit(), prisma.$disconnect()]);
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
