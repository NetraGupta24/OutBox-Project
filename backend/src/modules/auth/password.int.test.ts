import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { redis } from '../../lib/redis.js';
import { emailQueue, notificationQueue } from '../../queue/queues.js';
import { resetDatabase } from '../../../test/helpers.js';
import { exchangeCode, type GoogleProfile } from './google.js';
import { hashPassword, verifyPassword } from './password.js';

// Only the call to Google's token endpoint is faked.
vi.mock('./google.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./google.js')>()),
  exchangeCode: vi.fn(),
}));

const profile: GoogleProfile = {
  googleId: 'google-sub-777',
  email: 'maya@example.com',
  name: 'Maya Patel',
  avatarUrl: null,
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

function sessionCookie(res: Response): string | undefined {
  const raw = res.headers.getSetCookie().find((c) => c.startsWith('rb_session='));
  return raw?.split(';')[0];
}

const post = (path: string, body: unknown) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const me = (cookie: string) => fetch(`${base}/api/auth/me`, { headers: { cookie } });

const register = (email = profile.email, password = 'correct horse battery') =>
  post('/api/auth/register', { name: 'Maya', email, password });

const login = (email: string, password: string) => post('/api/auth/login', { email, password });

async function googleSignIn() {
  const start = await fetch(`${base}/api/auth/google`, { redirect: 'manual' });
  const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
  const oauth = start.headers
    .getSetCookie()
    .find((c) => c.startsWith('rb_oauth='))!
    .split(';')[0]!;
  const callback = await fetch(`${base}/api/auth/google/callback?code=c&state=${state}`, {
    redirect: 'manual',
    headers: { cookie: oauth },
  });
  return sessionCookie(callback)!;
}

describe('password hashing', () => {
  it('stores a salted scrypt hash and verifies only the right password', async () => {
    const a = await hashPassword('s3cret-pass');
    const b = await hashPassword('s3cret-pass');

    expect(a).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(a).not.toBe(b); // different salt
    expect(await verifyPassword('s3cret-pass', a)).toBe(true);
    expect(await verifyPassword('s3cret-pasS', a)).toBe(false);
  });
});

describe('email and password sign-up', () => {
  it('creates the account, signs the user in and never stores the password', async () => {
    const res = await register('Maya@Example.com');

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      user: { id: expect.any(Number), email: 'maya@example.com', name: 'Maya', avatarUrl: null },
    });
    const cookie = sessionCookie(res)!;
    expect(res.headers.getSetCookie().join('\n')).toMatch(/rb_session=.+; HttpOnly; SameSite=Lax/);
    expect((await me(cookie)).status).toBe(200);

    const row = await prisma.user.findUniqueOrThrow({ where: { email: 'maya@example.com' } });
    expect(row.googleId).toBeNull();
    expect(row.passwordHash).toMatch(/^scrypt\$/);
    expect(row.passwordHash).not.toContain('correct horse');
  });

  it('refuses a second account for the same email', async () => {
    await register();
    const again = await register('MAYA@example.com');

    expect(again.status).toBe(409);
    expect((await again.json()).error).toMatch(/already exists/);
  });

  it('points Google users to Google sign-in', async () => {
    await googleSignIn();
    const res = await register();

    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/signs in with Google/);
  });

  it('checks the fields', async () => {
    const res = await post('/api/auth/register', { name: '', email: 'nope', password: 'short' });

    expect(res.status).toBe(400);
    const messages = ((await res.json()).details as { message: string }[]).map((d) => d.message);
    expect(messages).toEqual(
      expect.arrayContaining([
        'Enter your name',
        'Enter a valid email address',
        'Use at least 8 characters',
      ]),
    );
  });
});

describe('email and password sign-in', () => {
  it('signs in with the right password, any email case', async () => {
    await register();
    const res = await login('  MAYA@example.com ', 'correct horse battery');

    expect(res.status).toBe(200);
    expect((await me(sessionCookie(res)!)).status).toBe(200);
  });

  it('gives the same answer for a wrong password and an unknown email', async () => {
    await register();
    const wrong = await login(profile.email, 'wrong password');
    const unknown = await login('nobody@example.com', 'wrong password');

    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await wrong.json()).toEqual(await unknown.json());
    expect(sessionCookie(wrong)).toBeUndefined();
  });

  it('refuses a Google-only account', async () => {
    await googleSignIn();
    expect((await login(profile.email, 'anything-at-all')).status).toBe(401);
  });

  it('blocks an email after 10 failed attempts, even with the right password', async () => {
    await register();
    for (let i = 0; i < 10; i++) {
      expect((await login(profile.email, `guess-${i}`)).status).toBe(401);
    }
    const blocked = await login(profile.email, 'correct horse battery');

    expect(blocked.status).toBe(429);
    expect((await blocked.json()).error).toMatch(/Too many attempts/);
    // Other accounts are not affected.
    await register('other@example.com');
    expect((await login('other@example.com', 'correct horse battery')).status).toBe(200);
  });
});

describe('Google sign-in for an email that has a password account', () => {
  it('links the accounts, removes the unverified password and ends its sessions', async () => {
    const created = await register();
    const passwordSession = sessionCookie(created)!;
    const { user } = (await created.json()) as { user: { id: number } };

    const googleSession = await googleSignIn();

    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row).toMatchObject({ googleId: profile.googleId, passwordHash: null });
    expect(await prisma.user.count()).toBe(1);
    expect((await me(googleSession)).status).toBe(200);
    // Whoever set the password is signed out and can't sign in with it again.
    expect((await me(passwordSession)).status).toBe(401);
    expect((await login(profile.email, 'correct horse battery')).status).toBe(401);
  });
});
