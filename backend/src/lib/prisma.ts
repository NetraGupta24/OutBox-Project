import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '../generated/prisma/client.js';
import { env } from '../config/env.js';

function poolConfigFromUrl(databaseUrl: string) {
  const url = new URL(databaseUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ''),
    connectionLimit: env.DB_POOL_SIZE,
    // MySQL 8 uses caching_sha2_password; allow the key exchange over non-TLS local connections.
    allowPublicKeyRetrieval: true,
    timezone: 'Z',
  };
}

const adapter = new PrismaMariaDb(poolConfigFromUrl(env.DATABASE_URL));

export const prisma = new PrismaClient({ adapter });
