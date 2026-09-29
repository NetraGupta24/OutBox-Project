import { prisma } from '../src/lib/prisma.js';
import { redis } from '../src/lib/redis.js';
import { encrypt } from '../src/lib/crypto.js';

// Deletes children before parents, so no foreign-key juggling is needed.
export async function resetDatabase() {
  await prisma.email.deleteMany();
  await prisma.campaign.deleteMany();
  await prisma.slackIntegration.deleteMany();
  await prisma.sender.deleteMany();
  await prisma.user.deleteMany();
  await redis.flushdb();
}

export async function createUserAndSender() {
  const user = await prisma.user.create({
    data: { email: 'tester@example.com', googleId: 'test-google-id', name: 'Tester' },
  });
  const sender = await prisma.sender.create({
    data: {
      email: 'sender@example.com',
      displayName: 'Sender',
      smtpHost: '127.0.0.1',
      smtpPort: 2525,
      smtpUser: 'sender@example.com',
      smtpPassEnc: encrypt('secret'),
    },
  });
  return { user, sender };
}
