import { describe, expect, it } from 'vitest';

import { notificationQuietUntil } from '../quietHours.js';

describe('notification quiet windows', () => {
  const policy = { timezone: 'UTC', quietStartHour: 22, quietEndHour: 8 };
  it('handles overnight windows and exact end boundaries', () => {
    expect(notificationQuietUntil(policy, Date.parse('2026-09-20T23:30:00Z'))).toBe(Date.parse('2026-09-21T08:00:00Z'));
    expect(notificationQuietUntil(policy, Date.parse('2026-09-20T08:00:00Z'))).toBeNull();
    expect(notificationQuietUntil({ ...policy, quietStartHour: 8 }, Date.now())).toBeNull();
  });
  it('handles spring gaps and repeated autumn hours without local-time arithmetic', () => {
    const local = { timezone: 'America/New_York', quietStartHour: 0, quietEndHour: 3 };
    expect(notificationQuietUntil(local, Date.parse('2026-03-08T06:30:00Z'))).toBe(Date.parse('2026-03-08T07:00:00Z'));
    expect(notificationQuietUntil(local, Date.parse('2026-11-01T05:30:00Z'))).toBe(Date.parse('2026-11-01T08:00:00Z'));
  });
  it('rejects invalid input rather than assuming notifications are allowed', () => {
    expect(() => notificationQuietUntil({ ...policy, quietStartHour: 24 }, Date.now())).toThrow();
    expect(() => notificationQuietUntil({ ...policy, timezone: 'invalid' }, Date.now())).toThrow();
    expect(() => notificationQuietUntil(policy, NaN)).toThrow();
  });
});
