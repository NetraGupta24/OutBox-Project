import nodemailer from 'nodemailer';
import type { Sender } from '../../generated/prisma/client.js';
import { getTransport } from '../senders/transportPool.js';
import type { Delivery } from './email.state.js';

export type OutgoingEmail = {
  id: number;
  campaignId: number;
  recipient: string;
  subject: string;
  bodyHtml: string;
  bodyText: string;
  sender: Sender;
};

export async function deliver(email: OutgoingEmail): Promise<Delivery> {
  // Deterministic Message-ID: a duplicate would be recognisable as the same message.
  const messageId = `<email-${email.id}.c${email.campaignId}@reachinbox.local>`;

  const info = await getTransport(email.sender).sendMail({
    from: { name: email.sender.displayName, address: email.sender.email },
    to: email.recipient,
    subject: email.subject,
    html: email.bodyHtml,
    text: email.bodyText,
    messageId,
    headers: { 'X-ReachInbox-Email-Id': String(email.id) },
  });

  return {
    messageId: (info as { messageId?: string }).messageId ?? messageId,
    // Link to the message in Ethereal's web inbox (false for other SMTP servers).
    previewUrl: nodemailer.getTestMessageUrl(info) || null,
    sentAt: new Date().toISOString(),
  };
}

type SmtpError = { code?: string; responseCode?: number };

/**
 * Decides whether retrying can help, from the SMTP reply code: 5xx is
 * permanent (e.g. 550 mailbox unavailable, 535 bad credentials), 4xx is
 * temporary (e.g. 451 try again later). Nodemailer labels both kinds of
 * rejected recipient EENVELOPE, so the label alone is not enough. Errors
 * without a reply code (timeouts, refused connections) are temporary.
 */
export function isPermanentFailure(err: unknown): boolean {
  const { code, responseCode } = (err ?? {}) as SmtpError;
  if (typeof responseCode === 'number') return responseCode >= 500 && responseCode < 600;
  return code === 'EAUTH';
}
