import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { LoginCard } from '@/features/auth/LoginCard';
import { getSession } from '@/lib/server/auth';
import { safeReturnPath } from '@/lib/safePath';

export const metadata: Metadata = { title: 'Login · ReachInbox Scheduler' };

export default async function LoginPage({ searchParams }: PageProps<'/login'>) {
  const params = await searchParams;
  const error = typeof params.error === 'string' ? params.error : undefined;
  const returnTo =
    typeof params.returnTo === 'string' ? safeReturnPath(params.returnTo) : undefined;

  // Already signed in (and the session is still valid): go to the app.
  const session = await getSession();
  if (session.status === 'signed-in') redirect(returnTo ?? safeReturnPath(null));

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <LoginCard error={error} returnTo={returnTo} />
    </main>
  );
}
