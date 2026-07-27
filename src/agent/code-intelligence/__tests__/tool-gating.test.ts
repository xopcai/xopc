import { describe, expect, it } from 'vitest';

import { isCodeIntelligenceEnabledForAgent } from '../tool-gating.js';

describe('isCodeIntelligenceEnabledForAgent', () => {
  const config = {
    enabled: true,
    agentIds: ['coder'],
  };

  it('enables configured agents only', () => {
    expect(isCodeIntelligenceEnabledForAgent(config, 'coder')).toBe(true);
    expect(isCodeIntelligenceEnabledForAgent(config, 'other')).toBe(false);
  });

  it('requires the feature and an agent id', () => {
    expect(isCodeIntelligenceEnabledForAgent({ ...config, enabled: false }, 'coder')).toBe(false);
    expect(isCodeIntelligenceEnabledForAgent(config, undefined)).toBe(false);
  });
});
