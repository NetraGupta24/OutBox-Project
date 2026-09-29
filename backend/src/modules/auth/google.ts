/**
 * Google sign-in: OAuth 2.0 authorization-code flow with PKCE. The ID token
 * returned by Google is verified (signature, audience, expiry) before use.
 */
import { randomBytes } from 'node:crypto';
import { CodeChallengeMethod, OAuth2Client } from 'google-auth-library';
import { env } from '../../config/env.js';

export type GoogleProfile = {
  googleId: string;
  email: string;
  name: string;
  avatarUrl: string | null;
};

export class GoogleSignInError extends Error {
  constructor(
    public readonly reason: 'unverified_email' | 'no_email' | 'exchange_failed',
    message: string,
  ) {
    super(message);
  }
}

export function googleConfigured(): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

function client(): OAuth2Client {
  return new OAuth2Client({
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri: env.GOOGLE_CALLBACK_URL,
  });
}

export async function createAuthRequest(): Promise<{
  url: string;
  state: string;
  codeVerifier: string;
}> {
  const oauth = client();
  const { codeVerifier, codeChallenge } = await oauth.generateCodeVerifierAsync();
  const state = randomBytes(24).toString('base64url');
  const url = oauth.generateAuthUrl({
    scope: ['openid', 'email', 'profile'],
    state,
    code_challenge: codeChallenge,
    code_challenge_method: CodeChallengeMethod.S256,
    prompt: 'select_account',
  });
  return { url, state, codeVerifier };
}

export async function exchangeCode(code: string, codeVerifier: string): Promise<GoogleProfile> {
  const oauth = client();
  let idToken: string | null | undefined;
  try {
    ({
      tokens: { id_token: idToken },
    } = await oauth.getToken({ code, codeVerifier }));
  } catch (err) {
    throw new GoogleSignInError(
      'exchange_failed',
      `Token exchange failed: ${(err as Error).message}`,
    );
  }
  if (!idToken) throw new GoogleSignInError('exchange_failed', 'Google returned no ID token');

  const ticket = await oauth.verifyIdToken({ idToken, audience: env.GOOGLE_CLIENT_ID! });
  const payload = ticket.getPayload();
  if (!payload?.email) throw new GoogleSignInError('no_email', 'Google account has no email');
  if (!payload.email_verified) {
    throw new GoogleSignInError('unverified_email', 'Google email address is not verified');
  }

  return {
    googleId: payload.sub,
    email: payload.email.toLowerCase(),
    name: payload.name?.trim() || payload.email.split('@')[0]!,
    avatarUrl: payload.picture ?? null,
  };
}
