import { describe, expect, it } from 'vitest';
import { isPermanentFailure } from './mailer.js';
import { errorMessage } from '../../lib/errors.js';

describe('isPermanentFailure', () => {
  it('treats 5xx SMTP replies as permanent', () => {
    expect(isPermanentFailure({ code: 'EENVELOPE', responseCode: 550 })).toBe(true);
    expect(isPermanentFailure({ code: 'EAUTH', responseCode: 535 })).toBe(true);
  });

  it('treats 4xx SMTP replies as temporary, whatever the error code', () => {
    expect(isPermanentFailure({ code: 'EENVELOPE', responseCode: 451 })).toBe(false);
    expect(isPermanentFailure({ code: 'EAUTH', responseCode: 454 })).toBe(false);
  });

  it('treats network errors as temporary and auth errors without a code as permanent', () => {
    expect(isPermanentFailure({ code: 'ETIMEDOUT' })).toBe(false);
    expect(isPermanentFailure({ code: 'ECONNECTION' })).toBe(false);
    expect(isPermanentFailure({ code: 'EAUTH' })).toBe(true);
    expect(isPermanentFailure(new Error('boom'))).toBe(false);
    expect(isPermanentFailure(undefined)).toBe(false);
  });
});

describe('errorMessage', () => {
  it('uses the message, or the name and code when the message is empty', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
    expect(errorMessage(Object.assign(new Error(''), { code: 'ECONNREFUSED' }))).toBe(
      'Error (ECONNREFUSED)',
    );
    expect(errorMessage('plain')).toBe('plain');
  });
});
