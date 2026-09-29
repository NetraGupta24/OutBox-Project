import type { Metadata } from 'next';
import { Suspense } from 'react';
import { EmailListView } from '@/features/emails/EmailListView';

export const metadata: Metadata = { title: 'Sent · ReachInbox Scheduler' };

export default function SentPage() {
  return (
    <Suspense>
      <EmailListView tab="sent" />
    </Suspense>
  );
}
