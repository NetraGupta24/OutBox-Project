/**
 * MySQL is the source of truth; BullMQ jobs are derived from it. This makes
 * sure every email that still has to be sent has a live job, e.g. after:
 *   - a crash between saving a campaign and queueing it
 *   - a Redis outage or data loss
 *   - a final attempt that failed while MySQL was unavailable
 *
 * It is idempotent (jobIds are deterministic), and runs when the worker starts
 * and whenever its Redis connection comes back. It is not run on a timer.
 */
import { prisma } from '../lib/prisma.js';
import { emailJobId, emailQueue, enqueueEmails, type EmailToQueue } from './queues.js';

const BATCH_SIZE = 500;

export type ReconcileReport = { checked: number; requeued: number };

export async function reconcileEmailJobs(): Promise<ReconcileReport> {
  let cursor = 0;
  let checked = 0;
  let requeued = 0;

  for (;;) {
    const rows = await prisma.email.findMany({
      where: { id: { gt: cursor }, status: { in: ['scheduled', 'delayed', 'sending'] } },
      select: { id: true, scheduledAt: true },
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1]!.id;
    checked += rows.length;

    const states = await Promise.all(rows.map((row) => emailQueue.getJobState(emailJobId(row.id))));
    const toQueue: EmailToQueue[] = [];
    for (const [i, row] of rows.entries()) {
      const state = states[i];
      if (state === 'unknown') {
        toQueue.push(row);
      } else if (state === 'completed' || state === 'failed') {
        // The job finished but the row still needs sending: replace the job.
        await emailQueue.remove(emailJobId(row.id));
        toQueue.push(row);
      }
      // waiting / delayed / active / prioritized: a live job exists already.
    }

    await enqueueEmails(toQueue);
    requeued += toQueue.length;
  }

  return { checked, requeued };
}
