import { timingSafeEqual } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { User } from '../../generated/prisma/client.js';
import { parseOrThrow } from '../../lib/validate.js';
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
import {
  checkPassword,
  createPasswordUser,
  normalizeEmail,
  toAuthUser,
  upsertGoogleUser,
} from './user.service.js';
import {
  assertLoginAllowed,
  assertSignupAllowed,
  clearLoginFailures,
  recordLoginFailure,
} from './loginLimiter.js';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from './password.js';

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

async function startSession(res: Response, user: User) {
  res.cookie(
    SESSION_COOKIE,
    await createSessionToken(user.id, user.sessionVersion),
    sessionCookieOptions,
  );
}

const clientIp = (req: Request) => req.ip ?? 'unknown';

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('Enter a valid email address').max(320));
const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH, `Use at most ${PASSWORD_MAX_LENGTH} characters`);

const registerSchema = z.object({
  name: z.string().trim().min(1, 'Enter your name').max(100),
  email: emailSchema,
  password: passwordSchema,
});

const loginSchema = z.object({
  email: emailSchema,
  // Any length is checked, so old or unusual passwords get a normal "wrong" answer.
  password: z.string().min(1, 'Enter your password').max(PASSWORD_MAX_LENGTH),
});

export const authRouter = Router();

// Email and password sign-up. Signs the new user in.
authRouter.post('/register', async (req, res) => {
  const input = parseOrThrow(registerSchema, req.body);
  await assertSignupAllowed(clientIp(req));
  const user = await createPasswordUser(input);
  await startSession(res, user);
  res.status(201).json({ user: toAuthUser(user) });
});

// Email and password sign-in. The same answer for an unknown email and a
// wrong password, so the form can't be used to find out who has an account.
authRouter.post('/login', async (req, res) => {
  const { email: rawEmail, password } = parseOrThrow(loginSchema, req.body);
  const email = normalizeEmail(rawEmail);
  const ip = clientIp(req);
  await assertLoginAllowed(email, ip);

  const user = await checkPassword(email, password);
  if (!user) {
    await recordLoginFailure(email, ip);
    res.status(401).json({ error: 'Wrong email or password.' });
    return;
  }
  await clearLoginFailures(email);
  await startSession(res, user);
  res.json({ user: toAuthUser(user) });
});

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
    await startSession(res, user);
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
