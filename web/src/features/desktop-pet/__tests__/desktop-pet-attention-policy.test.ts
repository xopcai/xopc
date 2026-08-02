import { describe, expect, it } from 'vitest';

import {
  desktopPetAttention,
  shouldShowDesktopPetActivity,
} from '../desktop-pet-attention-policy';
import type { DesktopPetActivity } from '../desktop-pet-session-state';

function activity(overrides: Partial<DesktopPetActivity>): DesktopPetActivity {
  return {
    sessionKey: 'agent:main:webchat:test',
    runId: 'run-1',
    sessionLabel: 'Test',
    sequence: 1,
    timestamp: 1_000,
    state: 'running',
    phase: 'running',
    action: 'Working',
    ...overrides,
  };
}

describe('desktop pet attention policy', () => {
  it('keeps ordinary work ambient in focus and companion modes', () => {
    const item = activity({});
    expect(desktopPetAttention(item, 'focus', 2_000)).toBe('ambient');
    expect(desktopPetAttention(item, 'companion', 2_000)).toBe('ambient');
  });

  it('always surfaces work that requires the user', () => {
    const item = activity({ state: 'waiting', phase: 'waiting' });
    expect(shouldShowDesktopPetActivity(item, 'focus', 2_000, 9_000)).toBe(true);
  });

  it('suppresses non-critical notices while reminders are paused', () => {
    const item = activity({ state: 'success' });
    expect(shouldShowDesktopPetActivity(item, 'companion', 2_000, 9_000)).toBe(false);
  });
});
