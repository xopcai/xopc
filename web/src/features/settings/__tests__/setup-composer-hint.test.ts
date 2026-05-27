import { describe, expect, it } from 'vitest';

import { composeSkillWireSeed } from '../setup-composer-hint';

describe('composeSkillWireSeed', () => {
  it('includes domain hint when provided', () => {
    expect(composeSkillWireSeed('configure-xopc', 'providers')).toBe(
      '/skill:configure-xopc Help me configure LLM provider API keys.',
    );
  });

  it('falls back to wire token only', () => {
    expect(composeSkillWireSeed('configure-xopc', null)).toBe('/skill:configure-xopc ');
  });

  it('includes mcp, heartbeat, and agents hints', () => {
    expect(composeSkillWireSeed('configure-xopc', 'mcp')).toContain('MCP');
    expect(composeSkillWireSeed('configure-xopc', 'heartbeat')).toContain('heartbeat');
    expect(composeSkillWireSeed('configure-xopc', 'agents')).toContain('default chat model');
  });
});
