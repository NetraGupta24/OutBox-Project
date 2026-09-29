import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Scheduled · ReachInbox Scheduler' };

// The email list is built in phase 7.
export default function ScheduledPage() {
  return (
    <section className="flex h-full min-h-80 items-center justify-center p-6 text-sm text-ink-muted">
      Scheduled emails will appear here.
    </section>
  );
}
