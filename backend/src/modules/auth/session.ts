/**
 * Session and sign-in cookies. Both are signed JWTs (HS256, JWT_SECRET) in
 * httpOnly cookies, so page scripts can't read them and they can't be forged.
 *
 * SameSite=Lax: browsers don't send the cookie on cross-site POSTs, which,
 * together with JSON-only request bodies, protects the API from CSRF.
 */
import type { CookieOptions } from 'express';
import { SignJWT, jwtVerify } from 'jose';
import { env } from '../../config/env.js';

export const SESSION_COOKIE = 'rb_session';
export const OAUTH_COOKIE = 'rb_oauth';

const SESSION_TTL_SECONDS = 7 * 24 * 3600;
const OAUTH_TTL_SECONDS = 10 * 60;
const ISSUER = 'reachinbox-scheduler';

const secret = new TextEncoder().encode(env.JWT_SECRET);
const secure = env.FRONTEND_URL.startsWith('https://');

export const sessionCookieOptions: CookieOptions = {
  httpOnly: true,
  secure,
  sameSite: 'lax',
  path: '/',
  maxAge: SESSION_TTL_SECONDS * 1000,
};

// Only needed on the way back from Google.
export const oauthCookieOptions: CookieOptions = {
  httpOnly: true,
  secure,
  sameSite: 'lax',
  path: '/api/auth',
  maxAge: OAUTH_TTL_SECONDS * 1000,
};

async function sign(payload: Record<string, unknown>, audience: string, ttlSeconds: number) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(secret);
}

async function verify(token: string, audience: string) {
  try {
    const { payload } = await jwtVerify(token, secret, { issuer: ISSUER, audience });
    return payload;
  } catch {
    return null; // bad signature, expired or malformed
  }
}

// `version` is the user's sessionVersion: raising it ends every older session.
export async function createSessionToken(userId: number, version = 0): Promise<string> {
  return sign({ sub: String(userId), v: version }, 'session', SESSION_TTL_SECONDS);
}

export async function readSessionToken(
  token: string,
): Promise<{ userId: number; version: number } | null> {
  const payload = await verify(token, 'session');
  const userId = Number(payload?.sub);
  if (!Number.isInteger(userId) || userId < 1) return null;
  // Tokens issued before versions existed count as version 0.
  const version = typeof payload?.v === 'number' ? payload.v : 0;
  return { userId, version };
}

// State for one sign-in attempt: CSRF state, PKCE verifier and where to return.
export type OAuthState = { state: string; codeVerifier: string; returnTo: string };

export async function createOAuthStateToken(state: OAuthState): Promise<string> {
  return sign(state, 'oauth', OAUTH_TTL_SECONDS);
}

export async function readOAuthStateToken(token: string): Promise<OAuthState | null> {
  const payload = await verify(token, 'oauth');
  if (
    typeof payload?.state !== 'string' ||
    typeof payload.codeVerifier !== 'string' ||
    typeof payload.returnTo !== 'string'
  ) {
    return null;
  }
  return { state: payload.state, codeVerifier: payload.codeVerifier, returnTo: payload.returnTo };
}
