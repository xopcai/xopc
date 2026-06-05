import { describe, expect, it } from 'vitest';

import { parseAgentDefaultsTab } from '@/features/settings/agents/agent-defaults-tabs';

describe('agent-defaults-tabs', () => {
  it('falls back to model strategy for unknown tab params', () => {
    expect(parseAgentDefaultsTab(null)).toBe('model-strategy');
    expect(parseAgentDefaultsTab('unknown')).toBe('model-strategy');
    expect(parseAgentDefaultsTab('browser')).toBe('model-strategy');
    expect(parseAgentDefaultsTab('runtime')).toBe('runtime');
    expect(parseAgentDefaultsTab('context')).toBe('context');
    expect(parseAgentDefaultsTab('memory')).toBe('memory');
    expect(parseAgentDefaultsTab('generation')).toBe('generation');
  });
});
