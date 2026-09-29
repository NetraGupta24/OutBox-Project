import type { Metadata } from 'next';
import { Suspense } from 'react';
import { EmailListView } from '@/features/emails/EmailListView';

export const metadata: Metadata = { title: 'Scheduled · ReachInbox Scheduler' };

export default function ScheduledPage() {
  return (
    <Suspense>
      <EmailListView tab="scheduled" />
    </Suspense>
  );
}
