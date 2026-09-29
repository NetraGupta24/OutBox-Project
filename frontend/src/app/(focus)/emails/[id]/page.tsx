import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { EmailDetailView } from '@/features/emails/EmailDetailView';

export const metadata: Metadata = { title: 'Email · ReachInbox Scheduler' };

export default async function EmailPage({ params }: PageProps<'/emails/[id]'>) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id < 1) notFound();
  return <EmailDetailView id={id} />;
}
