import { describe, expect, it } from 'vitest';

import {
  DEFAULT_RESET_AT_HOUR,
  evaluateSessionFreshness,
  resolveSessionResetPolicy,
} from '../reset-policy.js';

describe('resolveSessionResetPolicy', () => {
  it('keeps default reset values inactive until a reset policy is configured', () => {
    const policy = resolveSessionResetPolicy({ resetType: 'direct' });
    expect(policy).toMatchObject({
      mode: 'daily',
      atHour: DEFAULT_RESET_AT_HOUR,
      configured: false,
    });
  });

  it('uses resetByType direct override', () => {
    const policy = resolveSessionResetPolicy({
      sessionCfg: {
        scope: 'per-sender',
        mainKey: 'main',
        dmScope: 'main',
        resetByType: { direct: { mode: 'idle', idleMinutes: 30 } },
      },
      resetType: 'direct',
    });
    expect(policy.mode).toBe('idle');
    expect(policy.idleMinutes).toBe(30);
  });
});

describe('evaluateSessionFreshness', () => {
  it('marks session stale after daily boundary when sessionStartedAt is before reset', () => {
    const now = new Date(2026, 3, 25, 12, 0, 0, 0).getTime();
    const freshness = evaluateSessionFreshness({
      updatedAt: now,
      sessionStartedAt: now - 25 * 60 * 60_000,
      now,
      policy: { mode: 'daily', atHour: 4 },
    });
    expect(freshness.fresh).toBe(false);
    expect(freshness.dailyResetAt).toBeDefined();
  });

  it('keeps session fresh within daily window', () => {
    const now = new Date(2026, 3, 25, 12, 0, 0, 0).getTime();
    const freshness = evaluateSessionFreshness({
      updatedAt: now,
      sessionStartedAt: now - 2 * 60 * 60_000,
      now,
      policy: { mode: 'daily', atHour: 4 },
    });
    expect(freshness.fresh).toBe(true);
  });

  it('uses lastInteractionAt for idle expiry', () => {
    const now = 60 * 60_000;
    const freshness = evaluateSessionFreshness({
      updatedAt: now,
      lastInteractionAt: 0,
      now,
      policy: { mode: 'idle', atHour: 4, idleMinutes: 5 },
    });
    expect(freshness).toMatchObject({
      fresh: false,
      idleExpiresAt: 5 * 60_000,
    });
  });

  it('treats idleMinutes=0 as never expiring by inactivity', () => {
    const freshness = evaluateSessionFreshness({
      updatedAt: 1_000,
      now: 60 * 60 * 1_000,
      policy: { mode: 'idle', atHour: 4, idleMinutes: 0 },
    });
    expect(freshness).toEqual({
      fresh: true,
      dailyResetAt: undefined,
      idleExpiresAt: undefined,
    });
  });

  it('falls back to sessionStartedAt for idle when lastInteractionAt is missing', () => {
    const now = 60 * 60_000;
    const freshness = evaluateSessionFreshness({
      updatedAt: now,
      sessionStartedAt: 0,
      now,
      policy: { mode: 'idle', atHour: 4, idleMinutes: 5 },
    });
    expect(freshness.fresh).toBe(false);
    expect(freshness.idleExpiresAt).toBe(5 * 60_000);
  });
});
