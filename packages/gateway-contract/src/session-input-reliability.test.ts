import { describe, expect, it } from 'vitest';

import {
  sessionInputFingerprint,
  shouldRetrySessionInputStatus,
} from './session-input-reliability.js';

describe('session input reliability', () => {
  it('creates a stable fingerprint and includes attachments', () => {
    const first = sessionInputFingerprint({ content: 'hello', attachments: [{ name: 'a.txt', data: 'a' }] });
    const same = sessionInputFingerprint({ content: 'hello', attachments: [{ name: 'a.txt', data: 'a' }] });
    const changed = sessionInputFingerprint({ content: 'hello', attachments: [{ name: 'a.txt', data: 'b' }] });
    expect(same).toBe(first);
    expect(changed).not.toBe(first);
  });

  it('retries only transient HTTP statuses', () => {
    expect(shouldRetrySessionInputStatus(408)).toBe(true);
    expect(shouldRetrySessionInputStatus(429)).toBe(true);
    expect(shouldRetrySessionInputStatus(503)).toBe(true);
    expect(shouldRetrySessionInputStatus(400)).toBe(false);
    expect(shouldRetrySessionInputStatus(401)).toBe(false);
  });
});
