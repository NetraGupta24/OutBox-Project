import { Client } from '@elastic/elasticsearch';
import { env } from '../config/env.js';

export const es = new Client({
  node: env.ELASTICSEARCH_URL,
  requestTimeout: 10_000,
  maxRetries: 2,
});
