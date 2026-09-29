import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { User } from '@/types/api';

export const SESSION_COOKIE = 'rb_session';
const backendUrl = process.env.BACKEND_URL ?? 'http://localhost:4000';

export type SessionResult =
  { status: 'signed-in'; user: User } | { status: 'signed-out' } | { status: 'unavailable' };

// Asks the backend who the session cookie belongs to. Used by server components.
export async function getSession(): Promise<SessionResult> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return { status: 'signed-out' };

  try {
    const res = await fetch(`${backendUrl}/api/auth/me`, {
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
      cache: 'no-store',
    });
    if (res.status === 401) return { status: 'signed-out' };
    if (!res.ok) return { status: 'unavailable' };
    const body = (await res.json()) as { user: User };
    return { status: 'signed-in', user: body.user };
  } catch {
    return { status: 'unavailable' };
  }
}

// For signed-in pages: the user, 'unavailable' if the API can't be reached,
// or a redirect to the login page.
export async function requireUser(): Promise<User | 'unavailable'> {
  const session = await getSession();
  if (session.status === 'signed-out') redirect('/login?error=expired');
  return session.status === 'signed-in' ? session.user : 'unavailable';
}
