import { describe, expect, it } from 'vitest';

import { formatRelativeDuration, shareStatus } from '../share-time';

const m = {
  timeJustNow: 'a moment',
  timeMinutes: '{{n}}m',
  timeHours: '{{n}}h',
  timeDays: '{{n}}d',
};

describe('formatRelativeDuration', () => {
  it('< 1 minute → "a moment"', () => {
    expect(formatRelativeDuration(0, m)).toBe('a moment');
    expect(formatRelativeDuration(45_000, m)).toBe('a moment');
    expect(formatRelativeDuration(-30_000, m)).toBe('a moment');
  });

  it('minutes for < 1h', () => {
    expect(formatRelativeDuration(5 * 60_000, m)).toBe('5m');
    expect(formatRelativeDuration(59 * 60_000, m)).toBe('59m');
  });

  it('hours for < 1d', () => {
    expect(formatRelativeDuration(60 * 60_000, m)).toBe('1h');
    expect(formatRelativeDuration(23 * 60 * 60_000, m)).toBe('23h');
  });

  it('days from 1d onward', () => {
    expect(formatRelativeDuration(24 * 60 * 60_000, m)).toBe('1d');
    expect(formatRelativeDuration(10 * 24 * 60 * 60_000, m)).toBe('10d');
  });

  it('absolute value — past/future render with same magnitude', () => {
    const ms = 3 * 60 * 60_000;
    expect(formatRelativeDuration(ms, m)).toBe(formatRelativeDuration(-ms, m));
  });
});

describe('shareStatus', () => {
  it('revoked wins over expired', () => {
    expect(shareStatus({ revoked: true, expired: true })).toBe('revoked');
    expect(shareStatus({ revoked: true, expired: false })).toBe('revoked');
  });
  it('expired when not revoked', () => {
    expect(shareStatus({ revoked: false, expired: true })).toBe('expired');
  });
  it('active otherwise', () => {
    expect(shareStatus({ revoked: false, expired: false })).toBe('active');
  });
});
