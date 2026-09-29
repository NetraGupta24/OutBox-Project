import type { User } from '../../generated/prisma/client.js';
import { prisma } from '../../lib/prisma.js';
import type { GoogleProfile } from './google.js';

export type AuthUser = { id: number; email: string; name: string; avatarUrl: string | null };

export function toAuthUser(user: User): AuthUser {
  return { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl };
}

// Creates the user on first sign-in and refreshes name, email and photo on later ones.
export async function upsertGoogleUser(profile: GoogleProfile): Promise<User> {
  const data = { email: profile.email, name: profile.name, avatarUrl: profile.avatarUrl };
  const existing = await prisma.user.findFirst({
    where: { OR: [{ googleId: profile.googleId }, { email: profile.email }] },
    orderBy: { id: 'asc' },
  });
  if (existing) {
    return prisma.user.update({
      where: { id: existing.id },
      data: { ...data, googleId: profile.googleId },
    });
  }
  return prisma.user.create({ data: { ...data, googleId: profile.googleId } });
}
