import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { CampaignDetailView } from '@/features/campaigns/CampaignDetailView';

export const metadata: Metadata = { title: 'Campaign · ReachInbox Scheduler' };

export default async function CampaignPage({ params }: PageProps<'/campaigns/[id]'>) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id < 1) notFound();
  return (
    <Suspense>
      <CampaignDetailView id={id} />
    </Suspense>
  );
}
