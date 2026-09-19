import { describe, expect, it } from 'vitest';

import { deriveAgentIdFromDisplayName, validateAgentIdForNewAgent } from '../agent-id';

describe('agent id derivation', () => {
  it('keeps readable ASCII slugs', () => {
    expect(deriveAgentIdFromDisplayName('Code Helper')).toBe('code-helper');
  });

  it('uses a stable folder-safe fallback for non-ASCII display names', () => {
    const result = validateAgentIdForNewAgent(undefined, '数据分析师');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.agentId).toMatch(/^agent-[a-z0-9]{7}$/);
    expect(result.agentId).toBe(deriveAgentIdFromDisplayName('数据分析师'));
  });
});
