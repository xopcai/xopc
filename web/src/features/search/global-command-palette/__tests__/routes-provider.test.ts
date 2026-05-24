import { describe, expect, it } from 'vitest';

import { buildRouteSeeds } from '@/features/search/global-command-palette/routes-provider';

describe('buildRouteSeeds', () => {
  it('includes agent defaults slice routes for command palette navigation', () => {
    const seeds = buildRouteSeeds('en');
    const context = seeds.find((s) => s.id === 'route:settings:agent:settingsAgentContext');
    const memory = seeds.find((s) => s.id === 'route:settings:agent:settingsAgentMemory');
    expect(context?.path).toBe('/settings/agent-defaults?tab=context');
    expect(memory?.path).toBe('/settings/agent-defaults?tab=memory');
    expect(context?.keywords).toContain('compaction');
  });
});
