import { describe, expect, it } from 'vitest';

import {
  LEGACY_AGENT_DEFAULTS_SECTION_TO_TAB,
  parseAgentDefaultsTab,
} from '@/features/settings/agents/agent-defaults-tabs';

describe('agent-defaults-tabs', () => {
  it('maps legacy section ids to tab ids', () => {
    expect(LEGACY_AGENT_DEFAULTS_SECTION_TO_TAB['agent-workspace']).toBe('workspace');
    expect(LEGACY_AGENT_DEFAULTS_SECTION_TO_TAB['agent-system-prompt']).toBe('system-prompt');
  });

  it('falls back to chat for unknown tab params', () => {
    expect(parseAgentDefaultsTab(null)).toBe('chat');
    expect(parseAgentDefaultsTab('unknown')).toBe('chat');
    expect(parseAgentDefaultsTab('runtime')).toBe('runtime');
  });
});
