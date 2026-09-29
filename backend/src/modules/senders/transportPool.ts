import nodemailer, { type Transporter } from 'nodemailer';
import type { Sender } from '../../generated/prisma/client.js';
import { env } from '../../config/env.js';
import { decrypt } from '../../lib/crypto.js';

type CachedTransport = { version: number; transport: Transporter };

// One pooled SMTP connection set per sender, reused across jobs.
const transports = new Map<number, CachedTransport>();

// SMTP_DRY_RUN: build the full message but don't connect anywhere.
let dryRunTransport: Transporter | null = null;

export function getTransport(sender: Sender): Transporter {
  if (env.SMTP_DRY_RUN) {
    dryRunTransport ??= nodemailer.createTransport({ jsonTransport: true });
    return dryRunTransport;
  }

  // Rebuild the transport if the sender's settings changed since it was cached.
  const version = sender.updatedAt.getTime();
  const cached = transports.get(sender.id);
  if (cached?.version === version) return cached.transport;
  cached?.transport.close();

  const transport = nodemailer.createTransport({
    pool: true,
    maxConnections: 2,
    host: sender.smtpHost,
    port: sender.smtpPort,
    secure: sender.smtpSecure,
    auth: { user: sender.smtpUser, pass: decrypt(sender.smtpPassEnc) },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  });
  transports.set(sender.id, { version, transport });
  return transport;
}

export function closeTransports(): void {
  for (const { transport } of transports.values()) transport.close();
  transports.clear();
  dryRunTransport?.close();
  dryRunTransport = null;
}
