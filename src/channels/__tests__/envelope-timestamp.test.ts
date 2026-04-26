import { describe, expect, it } from 'vitest';

import {
  prependEnvelopeTimestamp,
  stripEnvelopeTimestampPrefix,
} from '../envelope-timestamp.js';

describe('stripEnvelopeTimestampPrefix', () => {
  it('removes bracketed date+time with timezone', () => {
    expect(stripEnvelopeTimestampPrefix('[2026-01-15 10:00 GMT+8] 你好')).toBe('你好');
    expect(stripEnvelopeTimestampPrefix('[2026-01-15 10:00 UTC] Hello')).toBe('Hello');
  });

  it('removes bracketed date+time without timezone suffix', () => {
    expect(stripEnvelopeTimestampPrefix('[2026-01-15 10:00] hi')).toBe('hi');
  });

  it('is inverse of prependEnvelopeTimestamp for typical content', () => {
    const inner = 'user asks something';
    const stamped = prependEnvelopeTimestamp(inner, 'UTC');
    expect(stripEnvelopeTimestampPrefix(stamped)).toBe(inner);
  });

  it('leaves text unchanged when no envelope prefix', () => {
    expect(stripEnvelopeTimestampPrefix('[note] hello')).toBe('[note] hello');
    expect(stripEnvelopeTimestampPrefix('plain')).toBe('plain');
  });
});
