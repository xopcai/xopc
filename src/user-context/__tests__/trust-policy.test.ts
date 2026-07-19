import { describe, expect, it } from 'vitest';

import {
  buildActionTrustPrompt,
  DEFAULT_USER_TRUST_LEVEL,
  isUserTrustLevel,
  resolveAutomationSafetyForTrust,
} from '../trust-policy.js';

describe('user trust policy', () => {
  it('uses ask-before-action as the safe default', () => {
    expect(DEFAULT_USER_TRUST_LEVEL).toBe('confirm');
  });

  it('validates only supported trust levels', () => {
    expect(isUserTrustLevel('confirm')).toBe(true);
    expect(isUserTrustLevel('auto')).toBe(true);
    expect(isUserTrustLevel('unrestricted')).toBe(false);
  });

  it('maps generated automation safety to the selected trust level', () => {
    expect(resolveAutomationSafetyForTrust('observe', 'auto_apply')).toBe('suggest_only');
    expect(resolveAutomationSafetyForTrust('suggest', 'ask_before_apply')).toBe('suggest_only');
    expect(resolveAutomationSafetyForTrust('confirm', 'auto_apply')).toBe('ask_before_apply');
    expect(resolveAutomationSafetyForTrust('confirm', 'suggest_only')).toBe('suggest_only');
    expect(resolveAutomationSafetyForTrust('auto', 'auto_apply')).toBe('auto_apply');
  });

  it('keeps automatic action inside authorized and high-risk boundaries', () => {
    const prompt = buildActionTrustPrompt('auto');
    expect(prompt).toContain('already-authorized, recoverable boundaries');
    expect(prompt).toContain('still require explicit confirmation');
    expect(prompt).toContain('direct user request');
  });
});
