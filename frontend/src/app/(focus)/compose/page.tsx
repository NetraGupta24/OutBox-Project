import type { Metadata } from 'next';
import { ComposeForm } from '@/features/compose/ComposeForm';

export const metadata: Metadata = { title: 'Compose · ReachInbox Scheduler' };

export default function ComposePage() {
  return <ComposeForm />;
}
