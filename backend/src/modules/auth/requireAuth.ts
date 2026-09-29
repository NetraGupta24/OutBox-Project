import type { NextFunction, Request, Response } from 'express';
import { env } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import { unauthorized } from '../../lib/httpError.js';

export type AuthUser = { id: number; email: string; name: string; avatarUrl: string | null };

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

/**
 * TEMPORARY until phase 6 (Google OAuth): when AUTH_DEV_BYPASS=true outside
 * production, the caller is identified by the `x-dev-user-email` header
 * (default dev@example.com) and that user is created on first use.
 */
async function devUser(req: Request): Promise<AuthUser> {
  const email = (req.header('x-dev-user-email') ?? 'dev@example.com').trim().toLowerCase();
  const user = await prisma.user.upsert({
    where: { email },
    create: { email, googleId: `dev:${email}`, name: email.split('@')[0] ?? email },
    update: {},
  });
  return { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl };
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (env.AUTH_DEV_BYPASS && env.NODE_ENV !== 'production') {
    req.user = await devUser(req);
    return next();
  }
  throw unauthorized();
}

// For handlers mounted behind requireAuth.
export function currentUser(req: Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}
