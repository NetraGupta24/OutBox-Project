import 'dotenv/config';
import { z } from 'zod';

// Empty values in .env count as "not set".
const optionalString = z
  .string()
  .optional()
  .transform((v) => v?.trim() || undefined);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  FRONTEND_URL: z.url().default('http://localhost:3000'),
  // How many proxies in front of the API to trust for X-Forwarded-* headers.
  TRUST_PROXY: z.coerce.number().int().min(0).default(1),

  DATABASE_URL: z.string().startsWith('mysql://'),
  DB_POOL_SIZE: z.coerce.number().int().min(1).default(10),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  ELASTICSEARCH_URL: z.url().default('http://localhost:9200'),
  ELASTICSEARCH_INDEX: z.string().min(1).default('emails'),

  // 32-byte key (64 hex chars) for encrypting secrets at rest. Generate: openssl rand -hex 32
  ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'must be 64 hex characters (openssl rand -hex 32)'),

  // Signs session cookies. Generate: openssl rand -hex 32
  JWT_SECRET: z.string().min(32, 'must be at least 32 characters (openssl rand -hex 32)'),
  // Google OAuth client (Google Cloud Console > APIs & Services > Credentials).
  // Without them the API still runs, but sign-in answers 503.
  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,
  // Must match an Authorized redirect URI of the OAuth client.
  // Default: FRONTEND_URL + /api/auth/google/callback (through the Next.js proxy).
  GOOGLE_CALLBACK_URL: z
    .union([z.literal(''), z.url()])
    .optional()
    .transform((v) => v || undefined),

  // Slack app (api.slack.com/apps) for rate-limit alerts. Without them the rest
  // of the app works, and "Connect Slack" explains what's missing.
  SLACK_CLIENT_ID: optionalString,
  SLACK_CLIENT_SECRET: optionalString,
  // Must match a Redirect URL of the Slack app. Default: FRONTEND_URL + the callback path.
  SLACK_REDIRECT_URI: z
    .union([z.literal(''), z.url()])
    .optional()
    .transform((v) => v || undefined),

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

// Settings that work but are unsafe or incomplete for a public deployment.
if (parsed.data.NODE_ENV === 'production') {
  const warnings = [
    !parsed.data.FRONTEND_URL.startsWith('https://') &&
      'FRONTEND_URL is not https: session cookies are sent without the Secure flag',
    !parsed.data.GOOGLE_CLIENT_ID && 'GOOGLE_CLIENT_ID is not set: nobody can sign in',
    parsed.data.SMTP_DRY_RUN && 'SMTP_DRY_RUN is on: no email is actually sent',
  ].filter(Boolean);
  for (const warning of warnings) console.warn(`Production config: ${warning}`);
}

export const env = {
  ...parsed.data,
  GOOGLE_CALLBACK_URL:
    parsed.data.GOOGLE_CALLBACK_URL ?? `${parsed.data.FRONTEND_URL}/api/auth/google/callback`,
  SLACK_REDIRECT_URI:
    parsed.data.SLACK_REDIRECT_URI ?? `${parsed.data.FRONTEND_URL}/api/integrations/slack/callback`,
};
export type Env = typeof env;
