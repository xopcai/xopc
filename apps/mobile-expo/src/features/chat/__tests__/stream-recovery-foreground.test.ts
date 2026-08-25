import { describe, expect, it } from 'vitest';

import { shouldWakeStreamRecoveryOnForeground } from '../stream-recovery-foreground';

describe('shouldWakeStreamRecoveryOnForeground', () => {
  it('wakes a resumable active chat when the app returns to foreground', () => {
    expect(shouldWakeStreamRecoveryOnForeground({
      previousAppState: 'background',
      nextAppState: 'active',
      sessionIsActive: true,
      hasResumableWork: true,
    })).toBe(true);
  });

  it('does not wake for ordinary active-state updates', () => {
    expect(shouldWakeStreamRecoveryOnForeground({
      previousAppState: 'active',
      nextAppState: 'active',
      sessionIsActive: true,
      hasResumableWork: true,
    })).toBe(false);
  });

  it('does not wake a chat without resumable work', () => {
    expect(shouldWakeStreamRecoveryOnForeground({
      previousAppState: 'inactive',
      nextAppState: 'active',
      sessionIsActive: true,
      hasResumableWork: false,
    })).toBe(false);
  });
});
