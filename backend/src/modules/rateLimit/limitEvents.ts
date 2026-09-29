import { notificationQueue, type RateLimitReachedEvent } from '../../queue/queues.js';

/**
 * Queues one notification per limit, per user, per window. The job ID makes
 * repeats a no-op, so it is safe to call for every email that hits the limit.
 */
export async function reportLimitReached(
  event: Omit<RateLimitReachedEvent, 'type'>,
  window: number,
): Promise<void> {
  const subject = event.scope === 'sender' ? event.senderId : event.campaignId;
  const jobId = `rate-limit-${event.scope}-${subject}-user-${event.userId}-window-${window}`;
  await notificationQueue.add(
    'rate-limit-reached',
    { type: 'rate-limit-reached', ...event },
    { jobId },
  );
}
