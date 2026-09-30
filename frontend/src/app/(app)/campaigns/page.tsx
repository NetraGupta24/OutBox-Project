import type { Metadata } from 'next';
import { Suspense } from 'react';
import { CampaignListView } from '@/features/campaigns/CampaignListView';

export const metadata: Metadata = { title: 'Campaigns · ReachInbox Scheduler' };

export default function CampaignsPage() {
  return (
    <Suspense>
      <CampaignListView />
    </Suspense>
  );
}
