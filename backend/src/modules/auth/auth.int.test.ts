import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { SignJWT } from 'jose';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { redis } from '../../lib/redis.js';
import { emailQueue, notificationQueue } from '../../queue/queues.js';
import { resetDatabase } from '../../../test/helpers.js';
import { GoogleSignInError, exchangeCode, type GoogleProfile } from './google.js';

// Everything is real except the server-to-server call to Google's token endpoint.
vi.mock('./google.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./google.js')>()),
  exchangeCode: vi.fn(),
}));

const profile: GoogleProfile = {
  googleId: 'google-sub-123',
  email: 'oliver@example.com',
  name: 'Oliver Brown',
  avatarUrl: 'https://lh3.googleusercontent.com/a/photo',
};

let server: Server;
let base: string;

beforeAll(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await Promise.allSettled([emailQueue.close(), notificationQueue.close()]);
  await Promise.allSettled([prisma.$disconnect(), redis.quit()]);
});

beforeEach(async () => {
  await resetDatabase();
  vi.mocked(exchangeCode).mockReset().mockResolvedValue(profile);
});

// name=value pairs from Set-Cookie headers.
function cookies(res: Response): Record<string, string> {
  return Object.fromEntries(
    res.headers.getSetCookie().map((c) => {
      const [pair] = c.split(';');
      const i = pair!.indexOf('=');
      return [pair!.slice(0, i), pair!.slice(i + 1)];
    }),
  );
}

const get = (path: string, cookie = '') =>
  fetch(`${base}${path}`, { redirect: 'manual', headers: cookie ? { cookie } : {} });

// Runs the whole flow and returns the session cookie.
async function signIn(returnTo?: string) {
  const start = await get(
    `/api/auth/google${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ''}`,
  );
  const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
  const oauth = cookies(start).rb_oauth!;
  const callback = await get(
    `/api/auth/google/callback?code=one-time-code&state=${state}`,
    `rb_oauth=${oauth}`,
  );
  return { callback, session: cookies(callback).rb_session };
}

describe('Google sign-in', () => {
  it('redirects to Google with state and PKCE, and remembers them in a cookie', async () => {
    const res = await get('/api/auth/google');

    expect(res.status).toBe(302);
    const url = new URL(res.headers.get('location')!);
    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.searchParams.get('client_id')).toBe('test-client-id.apps.googleusercontent.com');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'http://localhost:3000/api/auth/google/callback',
    );
    expect(url.searchParams.get('scope')).toBe('openid email profile');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBeTruthy();

    const setCookie = res.headers.getSetCookie().join('\n');
    expect(setCookie).toMatch(
      /rb_oauth=.+; Max-Age=600; Path=\/api\/auth; .*HttpOnly; SameSite=Lax/,
    );
  });

  it('creates the user, sets an httpOnly session cookie and returns to the app', async () => {
    const { callback, session } = await signIn();

    expect(callback.status).toBe(302);
    expect(callback.headers.get('location')).toBe('http://localhost:3000/scheduled');
    expect(callback.headers.getSetCookie().join('\n')).toMatch(
      /rb_session=.+; HttpOnly; SameSite=Lax/,
    );
    expect(vi.mocked(exchangeCode)).toHaveBeenCalledWith('one-time-code', expect.any(String));

    const me = await get('/api/auth/me', `rb_session=${session}`);
    expect(me.status).toBe(200);
    expect(await me.json()).toEqual({
      user: {
        id: expect.any(Number),
        email: profile.email,
        name: profile.name,
        avatarUrl: profile.avatarUrl,
      },
    });
  });

  it('updates the same user on later sign-ins', async () => {
    await signIn();
    vi.mocked(exchangeCode).mockResolvedValue({ ...profile, name: 'Oliver B.', avatarUrl: null });
    await signIn();

    const users = await prisma.user.findMany();
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({
      name: 'Oliver B.',
      avatarUrl: null,
      googleId: profile.googleId,
    });
  });

  it('returns to a same-site path, and ignores external ones', async () => {
    expect((await signIn('/sent')).callback.headers.get('location')).toBe(
      'http://localhost:3000/sent',
    );
    expect((await signIn('//evil.example')).callback.headers.get('location')).toBe(
      'http://localhost:3000/scheduled',
    );
    expect((await signIn('https://evil.example')).callback.headers.get('location')).toBe(
      'http://localhost:3000/scheduled',
    );
  });

  it('rejects a callback whose state does not match the cookie', async () => {
    const start = await get('/api/auth/google');
    const oauth = cookies(start).rb_oauth!;

    const wrongState = await get(
      '/api/auth/google/callback?code=x&state=forged',
      `rb_oauth=${oauth}`,
    );
    const noCookie = await get(`/api/auth/google/callback?code=x&state=anything`);

    for (const res of [wrongState, noCookie]) {
      expect(res.headers.get('location')).toBe('http://localhost:3000/login?error=state');
    }
    expect(vi.mocked(exchangeCode)).not.toHaveBeenCalled();
  });

  it('reports a cancelled consent screen and an unverified email', async () => {
    const cancelled = await get('/api/auth/google/callback?error=access_denied');
    expect(cancelled.headers.get('location')).toBe('http://localhost:3000/login?error=cancelled');

    vi.mocked(exchangeCode).mockRejectedValue(
      new GoogleSignInError('unverified_email', 'unverified'),
    );
    const { callback } = await signIn();
    expect(callback.headers.get('location')).toBe('http://localhost:3000/login?error=unverified');
    expect(await prisma.user.count()).toBe(0);
  });
});

describe('sessions', () => {
  it('protects the API: no cookie, a tampered cookie or an expired one is rejected', async () => {
    const { session } = await signIn();
    const expired = await new SignJWT({ sub: '1' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('reachinbox-scheduler')
      .setAudience('session')
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(new TextEncoder().encode(process.env.JWT_SECRET));

    expect((await get('/api/emails/counts', `rb_session=${session}`)).status).toBe(200);
    expect((await get('/api/emails/counts')).status).toBe(401);
    expect((await get('/api/emails/counts', `rb_session=${session}x`)).status).toBe(401);
    expect((await get('/api/emails/counts', `rb_session=${expired}`)).status).toBe(401);
    expect((await get('/api/auth/me')).status).toBe(401);
  });

  it('logs out by clearing the session cookie', async () => {
    const res = await fetch(`${base}/api/auth/logout`, { method: 'POST' });
    expect(res.status).toBe(204);
    expect(res.headers.getSetCookie().join('\n')).toMatch(
      /rb_session=; Path=\/; Expires=Thu, 01 Jan 1970/,
    );
  });

  it('ignores the old x-dev-user-email header', async () => {
    const res = await fetch(`${base}/api/emails/counts`, {
      headers: { 'x-dev-user-email': 'a@b.c' },
    });
    expect(res.status).toBe(401);
  });
});
