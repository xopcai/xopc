import { describe, expect, it } from 'vitest';

import { shouldWakeStreamRecoveryOnForeground } from '../stream-recovery-foreground';

describe('shouldWakeStreamRecoveryOnForeground', () => {
  it('wakes a resumable active chat when the app returns to foreground', () => {
    expect(shouldWakeStreamRecoveryOnForeground({
      previousAppState: 'background',
      nextAppState: 'active',
      sessionIsActive: true,
    })).toBe(true);
  });

  it('does not wake for ordinary active-state updates', () => {
    expect(shouldWakeStreamRecoveryOnForeground({
      previousAppState: 'active',
      nextAppState: 'active',
      sessionIsActive: true,
    })).toBe(false);
  });

  it('always reconciles an active chat because local pending state can be incomplete', () => {
    expect(shouldWakeStreamRecoveryOnForeground({
      previousAppState: 'inactive',
      nextAppState: 'active',
      sessionIsActive: true,
    })).toBe(true);
  });

  it('does not reconcile a chat that is no longer active', () => {
    expect(shouldWakeStreamRecoveryOnForeground({
      previousAppState: 'background',
      nextAppState: 'active',
      sessionIsActive: false,
    })).toBe(false);
  });
});
