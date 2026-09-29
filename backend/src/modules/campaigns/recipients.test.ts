import { describe, expect, it } from 'vitest';
import { htmlToText, normalizeRecipients } from './recipients.js';

describe('normalizeRecipients', () => {
  it('trims, lowercases and removes duplicates in first-seen order', () => {
    expect(normalizeRecipients([' B@x.com', 'a@x.com', 'b@X.com ', '', 'c@x.com'])).toEqual({
      valid: ['b@x.com', 'a@x.com', 'c@x.com'],
      invalid: [],
      duplicatesRemoved: 1,
    });
  });

  it('reports invalid addresses separately', () => {
    const result = normalizeRecipients(['ok@x.com', 'not-an-email', 'x@']);
    expect(result.valid).toEqual(['ok@x.com']);
    expect(result.invalid).toEqual(['not-an-email', 'x@']);
  });
});

describe('htmlToText', () => {
  it('strips tags and decodes common entities', () => {
    expect(htmlToText('<p>Hi&nbsp;<b>Tom</b></p><p>A &amp; B</p>')).toBe('Hi Tom\nA & B');
  });
});
