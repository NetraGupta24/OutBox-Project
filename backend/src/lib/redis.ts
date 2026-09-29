import { Redis } from 'ioredis';
import { env } from '../config/env.js';

type ConnectionOptions = {
  /** Name used in log lines. */
  label?: string;
  /**
   * Workers need maxRetriesPerRequest: null (BullMQ requirement) so they keep
   * waiting through a Redis outage. API-side connections should fail fast
   * instead, so a request returns an error rather than hanging.
   */
  failFast?: boolean;
};

export function createRedisConnection({
  label = 'redis',
  failFast = false,
}: ConnectionOptions = {}): Redis {
  const connection = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: failFast ? 1 : null,
  });

  // ioredis retries forever and emits an error per attempt: log one line per outage.
  let down = false;
  connection.on('error', (err) => {
    if (down) return;
    down = true;
    console.error(`[${label}] Redis unavailable (${err.message}), retrying`);
  });
  connection.on('ready', () => {
    if (down) console.log(`[${label}] Redis connection restored`);
    down = false;
  });

  return connection;
}

export const redis = createRedisConnection({ label: 'redis', failFast: true });
