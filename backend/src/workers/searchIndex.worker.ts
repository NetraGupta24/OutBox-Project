import { Worker, type Job } from 'bullmq';
import { errorMessage } from '../lib/errors.js';
import { createRedisConnection } from '../lib/redis.js';
import { indexEmails } from '../modules/search/emailIndex.js';
import { SEARCH_INDEX_QUEUE, type SearchIndexJobData } from '../queue/queues.js';

async function processIndexJob(job: Job<SearchIndexJobData>): Promise<number> {
  return indexEmails(job.data.emailIds);
}

export function createSearchIndexWorker(): Worker<SearchIndexJobData, number> {
  const worker = new Worker<SearchIndexJobData, number>(SEARCH_INDEX_QUEUE, processIndexJob, {
    connection: createRedisConnection({ label: 'search-index' }),
    concurrency: 2,
  });
  let lastError = '';
  worker.on('failed', (job, err) => {
    const message = errorMessage(err);
    if (message === lastError) return; // one line per outage, not per job
    lastError = message;
    console.warn(
      `[search-index] ${job?.data.emailIds.length ?? 0} email(s) not indexed yet: ${message}`,
    );
  });
  worker.on('completed', () => {
    lastError = '';
  });
  worker.on('error', () => {}); // connection errors are logged by the connection
  return worker;
}
