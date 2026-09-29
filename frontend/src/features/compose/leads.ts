// Finding email addresses in pasted text and uploaded CSV/TXT files.

export const MAX_RECIPIENTS = 10_000;

const EMAIL_IN_TEXT = /[a-z0-9._%+'-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi;
const EMAIL = /^[a-z0-9._%+'-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}$/i;

export function isEmail(value: string): boolean {
  return EMAIL.test(value.trim());
}

// Every address in the text, lower-cased, in order. Works for any CSV layout:
// the addresses are found wherever they are, headers and other columns are ignored.
export function findEmails(text: string): string[] {
  return (text.match(EMAIL_IN_TEXT) ?? []).map((e) => e.toLowerCase());
}

// Cells that look like an attempt at an address but aren't valid.
export function findInvalid(text: string): string[] {
  return text
    .split(/[\s,;"']+/)
    .filter((cell) => cell.includes('@') && !isEmail(cell))
    .slice(0, 20);
}

export type MergeResult = { list: string[]; added: number; duplicates: number; overLimit: number };

// Adds addresses to the list, skipping ones already in it or in the batch.
export function mergeRecipients(existing: string[], incoming: string[]): MergeResult {
  const seen = new Set(existing);
  const list = [...existing];
  let duplicates = 0;
  let overLimit = 0;
  for (const email of incoming) {
    if (seen.has(email)) {
      duplicates++;
    } else if (list.length >= MAX_RECIPIENTS) {
      overLimit++;
    } else {
      seen.add(email);
      list.push(email);
    }
  }
  return { list, added: list.length - existing.length, duplicates, overLimit };
}
