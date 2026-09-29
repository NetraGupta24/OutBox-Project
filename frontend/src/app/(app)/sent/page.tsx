import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Sent · ReachInbox Scheduler' };

// The email list is built in phase 7.
export default function SentPage() {
  return (
    <section className="flex h-full min-h-80 items-center justify-center p-6 text-sm text-ink-muted">
      Sent emails will appear here.
    </section>
  );
}
