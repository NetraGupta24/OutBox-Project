import { ServerUnavailable } from '@/components/ServerUnavailable';
import { KeyboardShortcuts } from '@/features/layout/KeyboardShortcuts';
import { Sidebar } from '@/features/layout/Sidebar';
import { requireUser } from '@/lib/server/auth';
import { SlackResultToast } from '@/features/slack/SlackResultToast';
import { Suspense } from 'react';

// Mailbox pages: sidebar plus content. Needs a valid session.
export default async function AppLayout({ children }: LayoutProps<'/'>) {
  const user = await requireUser();
  if (user === 'unavailable') return <ServerUnavailable />;

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <KeyboardShortcuts />
      <Suspense>
        <SlackResultToast />
      </Suspense>
      <Sidebar user={user} />
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
