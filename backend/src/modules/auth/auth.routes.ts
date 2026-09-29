import { timingSafeEqual } from 'node:crypto';
import { Router, type Response } from 'express';
import { env } from '../../config/env.js';
import { errorMessage } from '../../lib/errors.js';
import { GoogleSignInError, createAuthRequest, exchangeCode, googleConfigured } from './google.js';
import { currentUser, requireAuth } from './requireAuth.js';
import {
  OAUTH_COOKIE,
  SESSION_COOKIE,
  createOAuthStateToken,
  createSessionToken,
  oauthCookieOptions,
  readOAuthStateToken,
  sessionCookieOptions,
} from './session.js';
import { upsertGoogleUser } from './user.service.js';

const DEFAULT_RETURN_TO = '/scheduled';

// Only same-site paths, so the sign-in flow can't be used as an open redirect.
function safeReturnTo(value: unknown): string {
  if (typeof value !== 'string' || value.length > 200) return DEFAULT_RETURN_TO;
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
    return DEFAULT_RETURN_TO;
  }
  if (value.startsWith('/login')) return DEFAULT_RETURN_TO;
  return value;
}

function sameString(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

type LoginError = 'cancelled' | 'state' | 'unverified' | 'failed' | 'not_configured';

function backToLogin(res: Response, error: LoginError) {
  res.clearCookie(OAUTH_COOKIE, oauthCookieOptions);
  res.redirect(`${env.FRONTEND_URL}/login?error=${error}`);
}

export const authRouter = Router();

// Step 1: send the browser to Google's consent screen.
authRouter.get('/google', async (req, res) => {
  if (!googleConfigured()) return backToLogin(res, 'not_configured');

  const { url, state, codeVerifier } = await createAuthRequest();
  const returnTo = safeReturnTo(req.query.returnTo);
  res.cookie(
    OAUTH_COOKIE,
    await createOAuthStateToken({ state, codeVerifier, returnTo }),
    oauthCookieOptions,
  );
  res.redirect(url);
});

// Step 2: Google redirects back here with a one-time code.
authRouter.get('/google/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return backToLogin(res, error === 'access_denied' ? 'cancelled' : 'failed');

  const cookie: unknown = req.cookies?.[OAUTH_COOKIE];
  const saved = typeof cookie === 'string' ? await readOAuthStateToken(cookie) : null;
  if (!saved || typeof state !== 'string' || !sameString(saved.state, state)) {
    return backToLogin(res, 'state');
  }
  if (typeof code !== 'string' || !code) return backToLogin(res, 'failed');

  try {
    const profile = await exchangeCode(code, saved.codeVerifier);
    const user = await upsertGoogleUser(profile);
    res.clearCookie(OAUTH_COOKIE, oauthCookieOptions);
    res.cookie(SESSION_COOKIE, await createSessionToken(user.id), sessionCookieOptions);
    res.redirect(`${env.FRONTEND_URL}${saved.returnTo}`);
  } catch (err) {
    console.error('Google sign-in failed:', errorMessage(err));
    const unverified = err instanceof GoogleSignInError && err.reason === 'unverified_email';
    backToLogin(res, unverified ? 'unverified' : 'failed');
  }
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: currentUser(req) });
});

authRouter.post('/logout', (_req, res) => {
  res.clearCookie(SESSION_COOKIE, sessionCookieOptions);
  res.status(204).end();
});
