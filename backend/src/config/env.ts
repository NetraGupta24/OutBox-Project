import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  FRONTEND_URL: z.url().default('http://localhost:3000'),

  DATABASE_URL: z.string().startsWith('mysql://'),
  DB_POOL_SIZE: z.coerce.number().int().min(1).default(10),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  ELASTICSEARCH_URL: z.url().default('http://localhost:9200'),

  // 32-byte key (64 hex chars) for encrypting secrets at rest. Generate: openssl rand -hex 32
  ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'must be 64 hex characters (openssl rand -hex 32)'),

  // TEMPORARY until Google login (phase 6): identify API callers by the
  // x-dev-user-email header. Ignored when NODE_ENV=production.
  AUTH_DEV_BYPASS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  // Bull Board queue dashboard at /admin/queues (HTTP Basic auth). Disabled without a password.
  BULL_BOARD_USERNAME: z.string().min(1).default('admin'),
  BULL_BOARD_PASSWORD: z
    .union([z.literal(''), z.string().min(8)])
    .optional()
    .transform((v) => v || undefined),

  // Scheduler tuning
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).default(5),
  MIN_SEND_INTERVAL_MS: z.coerce.number().int().min(0).default(2000),
  MAX_EMAILS_PER_HOUR_PER_SENDER: z.coerce.number().int().min(1).default(200),
  // Length of a rate-limit window. One hour in normal use; shorten it (e.g. 60000)
  // to watch limits being hit and emails moving to the next window during a demo.
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(10_000).default(3_600_000),
  MAX_RECIPIENTS_PER_CAMPAIGN: z.coerce.number().int().min(1).default(10_000),
  SMTP_DRY_RUN: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:');
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
