/**
 * Seeds shared Ethereal sender accounts.
 *
 *   npm run seed:senders              creates Ethereal accounts via the Nodemailer API
 *   ETHEREAL_SENDERS="u1:p1,u2:p2"    uses existing accounts from https://ethereal.email instead
 *   npm run seed:senders -- --verify  also checks each SMTP login
 *
 * Safe to re-run: senders are upserted by email, and new accounts are only
 * created when fewer than SEED_SENDER_COUNT shared senders exist.
 */
import nodemailer from 'nodemailer';
import { prisma } from '../lib/prisma.js';
import { encrypt, decrypt } from '../lib/crypto.js';

const ETHEREAL_HOST = 'smtp.ethereal.email';
const ETHEREAL_PORT = 587;

type Account = { user: string; pass: string };

function accountsFromEnv(): Account[] {
  const raw = process.env.ETHEREAL_SENDERS?.trim();
  if (!raw) return [];
  return raw.split(',').map((pair) => {
    const index = pair.indexOf(':');
    if (index <= 0) throw new Error(`ETHEREAL_SENDERS entry "${pair}" must be user:pass`);
    return { user: pair.slice(0, index).trim(), pass: pair.slice(index + 1).trim() };
  });
}

async function createAccounts(count: number): Promise<Account[]> {
  const accounts: Account[] = [];
  try {
    for (let i = 0; i < count; i++) {
      const account = await nodemailer.createTestAccount();
      accounts.push({ user: account.user, pass: account.pass });
    }
  } catch (err) {
    throw new Error(
      `Could not create Ethereal accounts (${(err as Error).message}). ` +
        'Create them at https://ethereal.email and set ETHEREAL_SENDERS="user:pass,user:pass".',
      { cause: err },
    );
  }
  return accounts;
}

function displayNameFor(email: string, index: number): string {
  const local = email.split('@')[0] ?? `sender${index + 1}`;
  return local.charAt(0).toUpperCase() + local.slice(1);
}

async function upsertSender(account: Account, index: number) {
  const data = {
    displayName: displayNameFor(account.user, index),
    smtpHost: ETHEREAL_HOST,
    smtpPort: ETHEREAL_PORT,
    smtpSecure: false,
    smtpUser: account.user,
    smtpPassEnc: encrypt(account.pass),
    isActive: true,
  };
  return prisma.sender.upsert({
    where: { email: account.user },
    create: { email: account.user, ...data },
    update: data,
  });
}

async function verifySenders() {
  const senders = await prisma.sender.findMany({ where: { userId: null, isActive: true } });
  for (const sender of senders) {
    const transport = nodemailer.createTransport({
      host: sender.smtpHost,
      port: sender.smtpPort,
      secure: sender.smtpSecure,
      auth: { user: sender.smtpUser, pass: decrypt(sender.smtpPassEnc) },
    });
    try {
      await transport.verify();
      console.log(`  ✓ ${sender.email} SMTP login ok`);
    } catch (err) {
      console.log(`  ✗ ${sender.email} SMTP login failed: ${(err as Error).message}`);
    }
  }
}

async function main() {
  const target = Number(process.env.SEED_SENDER_COUNT ?? 3);
  let accounts = accountsFromEnv();

  if (accounts.length === 0) {
    const existing = await prisma.sender.count({ where: { userId: null, isActive: true } });
    if (existing >= target) {
      console.log(`${existing} shared senders already exist, nothing to create.`);
    } else {
      console.log(`Creating ${target - existing} Ethereal account(s)...`);
      accounts = await createAccounts(target - existing);
    }
  }

  for (const [index, account] of accounts.entries()) {
    const sender = await upsertSender(account, index);
    console.log(`  • sender #${sender.id} ${sender.email}`);
  }

  const all = await prisma.sender.findMany({
    where: { userId: null },
    select: { id: true, email: true, isActive: true },
    orderBy: { id: 'asc' },
  });
  console.log('Shared senders:', all);

  if (process.argv.includes('--verify')) {
    console.log('Verifying SMTP logins...');
    await verifySenders();
  }
}

main()
  .catch((err) => {
    console.error(`Seeding senders failed: ${(err as Error).message}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
