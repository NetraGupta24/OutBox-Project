import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../../lib/prisma.js';
import { unauthorized } from '../../lib/httpError.js';
import { SESSION_COOKIE, readSessionToken } from './session.js';
import { toAuthUser, type AuthUser } from './user.service.js';

export type { AuthUser };

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

// Accepts a request only with a valid session cookie for an existing user.
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const token: unknown = req.cookies?.[SESSION_COOKIE];
  if (typeof token !== 'string' || !token) throw unauthorized();

  const userId = await readSessionToken(token);
  if (!userId) throw unauthorized('Session expired, please sign in again');

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw unauthorized();

  req.user = toAuthUser(user);
  next();
}

// For handlers mounted behind requireAuth.
export function currentUser(req: Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}
