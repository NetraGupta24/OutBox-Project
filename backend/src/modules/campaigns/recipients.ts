import { z } from 'zod';

const emailSchema = z.email();

export type NormalizedRecipients = {
  valid: string[];
  invalid: string[];
  duplicatesRemoved: number;
};

// Trims, lowercases and de-duplicates, keeping first-seen order.
export function normalizeRecipients(input: string[]): NormalizedRecipients {
  const seen = new Set<string>();
  const valid: string[] = [];
  const invalid: string[] = [];
  let duplicatesRemoved = 0;

  for (const raw of input) {
    const email = raw.trim().toLowerCase();
    if (!email) continue;
    if (!emailSchema.safeParse(email).success) {
      invalid.push(raw.trim());
      continue;
    }
    if (seen.has(email)) {
      duplicatesRemoved++;
      continue;
    }
    seen.add(email);
    valid.push(email);
  }

  return { valid, invalid, duplicatesRemoved };
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6])\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
