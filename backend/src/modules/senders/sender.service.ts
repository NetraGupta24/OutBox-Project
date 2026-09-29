import type { Sender } from '../../generated/prisma/client.js';
import { env } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import { badRequest } from '../../lib/httpError.js';

export type SenderSummary = {
  id: number;
  email: string;
  displayName: string;
  hourlyLimit: number;
};

// A sender's own limit can only lower the global per-sender cap.
export function senderHourlyLimit(sender: Pick<Sender, 'hourlyLimit'>): number {
  return Math.min(
    sender.hourlyLimit ?? env.MAX_EMAILS_PER_HOUR_PER_SENDER,
    env.MAX_EMAILS_PER_HOUR_PER_SENDER,
  );
}

function toSummary(sender: Sender): SenderSummary {
  return {
    id: sender.id,
    email: sender.email,
    displayName: sender.displayName,
    hourlyLimit: senderHourlyLimit(sender),
  };
}

// Shared senders (user_id NULL) plus the user's own.
export async function listSenders(userId: number): Promise<SenderSummary[]> {
  const senders = await prisma.sender.findMany({
    where: { isActive: true, OR: [{ userId: null }, { userId }] },
    orderBy: { id: 'asc' },
  });
  return senders.map(toSummary);
}

export async function getUsableSender(userId: number, senderId: number): Promise<Sender> {
  const sender = await prisma.sender.findFirst({
    where: { id: senderId, isActive: true, OR: [{ userId: null }, { userId }] },
  });
  if (!sender) throw badRequest(`Sender ${senderId} does not exist or is not available`);
  return sender;
}
