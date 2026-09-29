import { redirect } from 'next/navigation';
import { Sidebar } from '@/features/layout/Sidebar';
import { getSession } from '@/lib/server/auth';

// Every page in (app) needs a valid session, checked with the backend.
export default async function AppLayout({ children }: LayoutProps<'/'>) {
  const session = await getSession();
  if (session.status === 'signed-out') redirect('/login?error=expired');
  if (session.status === 'unavailable') {
    return (
      <main className="flex flex-1 items-center justify-center p-6 text-center">
        <div>
          <h1 className="text-lg font-semibold">Can&apos;t reach the server</h1>
          <p className="mt-1 text-sm text-ink-muted">Check that the API is running, then reload.</p>
        </div>
      </main>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <Sidebar user={session.user} />
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
