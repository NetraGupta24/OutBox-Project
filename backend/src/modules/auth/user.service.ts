import type { User } from '../../generated/prisma/client.js';
import { prisma } from '../../lib/prisma.js';
import { HttpError } from '../../lib/httpError.js';
import type { GoogleProfile } from './google.js';
import { hashPassword, verifyAgainstDummy, verifyPassword } from './password.js';

export type AuthUser = { id: number; email: string; name: string; avatarUrl: string | null };

export function toAuthUser(user: User): AuthUser {
  return { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl };
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Creates the user on first sign-in and refreshes name, email and photo on later ones.
 *
 * An existing email-and-password account with the same address is linked to
 * this Google account. Its password was set without proving the address was
 * the owner's, while Google has just verified it, so the password is removed
 * and its sessions are ended: whoever registered the address first can't keep
 * access to the owner's account. The owner signs in with Google from then on.
 */
export async function upsertGoogleUser(profile: GoogleProfile): Promise<User> {
  const data = { email: profile.email, name: profile.name, avatarUrl: profile.avatarUrl };
  const existing = await prisma.user.findFirst({
    where: { OR: [{ googleId: profile.googleId }, { email: profile.email }] },
    orderBy: { id: 'asc' },
  });
  if (!existing) return prisma.user.create({ data: { ...data, googleId: profile.googleId } });

  const linkingPasswordAccount = existing.googleId === null && existing.passwordHash !== null;
  return prisma.user.update({
    where: { id: existing.id },
    data: {
      ...data,
      googleId: profile.googleId,
      ...(linkingPasswordAccount ? { passwordHash: null, sessionVersion: { increment: 1 } } : {}),
    },
  });
}

export async function createPasswordUser(input: {
  name: string;
  email: string;
  password: string;
}): Promise<User> {
  const email = normalizeEmail(input.email);
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw new HttpError(
      409,
      existing.googleId && !existing.passwordHash
        ? 'This email signs in with Google. Use "Login with Google".'
        : 'An account with this email already exists. Sign in instead.',
    );
  }
  const passwordHash = await hashPassword(input.password);
  try {
    return await prisma.user.create({ data: { email, name: input.name.trim(), passwordHash } });
  } catch (err) {
    // Two sign-ups for the same email at once: the unique index decides.
    if ((err as { code?: string }).code === 'P2002') {
      throw new HttpError(409, 'An account with this email already exists. Sign in instead.');
    }
    throw err;
  }
}

// The user, if the email and password match. Takes about as long either way.
export async function checkPassword(email: string, password: string): Promise<User | null> {
  const user = await prisma.user.findUnique({ where: { email: normalizeEmail(email) } });
  if (!user?.passwordHash) {
    await verifyAgainstDummy(password);
    return null;
  }
  return (await verifyPassword(password, user.passwordHash)) ? user : null;
}
