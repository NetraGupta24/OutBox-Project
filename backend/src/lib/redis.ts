import { Redis } from 'ioredis';
import { env } from '../config/env.js';

/**
 * Workers need maxRetriesPerRequest: null (BullMQ requirement) so they keep
 * waiting through a Redis outage. API-side connections should fail fast
 * instead, so a request returns an error rather than hanging.
 */
export function createRedisConnection({ failFast = false } = {}): Redis {
  return new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: failFast ? 1 : null,
  });
}

export const redis = createRedisConnection({ failFast: true });
